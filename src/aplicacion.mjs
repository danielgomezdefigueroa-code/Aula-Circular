import express from 'express';
import session from 'express-session';
import conectarPg from 'connect-pg-simple';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { crearHash, comprobarClave, claveValida, Ocupado } from './claves.mjs';
import { rutasDocentes } from './docencia.mjs';
import { rutasAnuncios } from './anuncios.mjs';

const token = () => randomBytes(32).toString('hex');
const guardar = sesion => new Promise((ok,fallo) => sesion.save(e => e ? fallo(e) : ok()));
const regenerar = req => new Promise((ok,fallo) => req.session.regenerate(e => e ? fallo(e) : ok()));
const destruir = req => new Promise((ok,fallo) => req.session.destroy(e => e ? fallo(e) : ok()));
const correoNormalizado = valor => typeof valor === 'string' ? valor.trim().toLowerCase() : '';
const cuerpoValido = (cuerpo, campos) => cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) &&
  Object.keys(cuerpo).every(campo => campos.includes(campo));
const cookie = { httpOnly:true, sameSite:'lax', secure:process.env.NODE_ENV==='production', path:'/' };

export async function crearAplicacion(pool, { origen, secreto, esquema='public', limitar=true } = {}) {
  if (!secreto || secreto.length < 32) throw new Error('Prepara SESSION_SECRET antes de arrancar.');
  if (!origen || new URL(origen).origin !== origen) throw new Error('APP_ORIGIN debe contener el origen exacto.');
  const app = express();
  app.disable('x-powered-by');
  const Almacen = conectarPg(session);
  const almacen = new Almacen({ pool, schemaName:esquema, tableName:'sesion', createTableIfMissing:false });
  app.use('/api', (_req,res,next) => {res.set('Cache-Control','private, no-store');next();});
  app.get('/api/salud', async (_req,res) => {
    try {await pool.query('SELECT 1');res.json({estado:'listo',baseDatos:true});}
    catch {res.status(503).json({error:'SERVICIO_NO_DISPONIBLE'});}
  });
  app.use('/api', session({name:'aula.sid',secret:secreto,store:almacen,
    resave:false,saveUninitialized:false,rolling:true,cookie:{...cookie,maxAge:30*60*1000}}));
  app.use('/api', express.json({limit:'32kb'}));
  app.use('/api', async (req,res,next) => {
    if (req.session.usuarioId) {
      const r = await pool.query(`SELECT u.id,u.alias,u.correo,u.estado,u.auth_version,
        u.curso_solicitado_id,u.curso_confirmado_id,
        cs.nombre AS curso_solicitado,cc.nombre AS curso_confirmado,
        ARRAY(SELECT rol FROM usuario_rol WHERE usuario_id=u.id ORDER BY rol) AS roles
        FROM usuario u LEFT JOIN curso cs ON cs.id=u.curso_solicitado_id
        LEFT JOIN curso cc ON cc.id=u.curso_confirmado_id WHERE u.id=$1`,[req.session.usuarioId]);
      const u = r.rows[0];
      if (!u || u.auth_version !== req.session.authVersion ||
          !Number.isFinite(req.session.creadaEn) || Date.now()-req.session.creadaEn >= 8*60*60*1000) {
        await destruir(req);res.clearCookie('aula.sid',cookie);
        return res.status(401).json({error:'SESION_CADUCADA'});
      }
      delete u.auth_version;
      req.usuario = u;
    }
    next();
  });
  app.use('/api', (req,res,next) => {
    if (!['POST','PATCH','DELETE','PUT'].includes(req.method)) return next();
    const recibido=req.get('X-CSRF-Token');const esperado=req.session?.csrf;
    if (req.get('Origin') !== origen || !recibido || !esperado ||
        !/^[a-f0-9]{64}$/.test(recibido) ||
        !timingSafeEqual(Buffer.from(recibido),Buffer.from(esperado))) {
      return res.status(403).json({error:'CSRF_INVALIDO'});
    }
    next();
  });
  const sesionNecesaria = (req,res,next) => req.usuario ? next() : res.status(401).json({error:'SIN_SESION'});
  const activaNecesaria = (req,res,next) => req.usuario.estado==='activo' ? next() :
    res.status(403).json({error:req.usuario.estado==='pendiente' ? 'CUENTA_PENDIENTE':'CUENTA_SUSPENDIDA'});
  app.get('/api/csrf', async (req,res) => {
    req.session.csrf ??= token();await guardar(req.session);res.json({token:req.session.csrf});
  });
  app.get('/api/cursos', async (_req,res) => {
    const r=await pool.query('SELECT id,codigo,nombre FROM curso WHERE activo ORDER BY codigo LIMIT 100');
    res.json({datos:r.rows});
  });
  const hashFicticio=await crearHash(randomBytes(32).toString('hex'));
  const limites = limitar ? [rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,
    message:{error:'DEMASIADOS_INTENTOS'}})] : [];
  const porCuenta = limitar ? [rateLimit({windowMs:15*60*1000,limit:5,skipSuccessfulRequests:true,
    standardHeaders:'draft-8',legacyHeaders:false,
    keyGenerator:req => ipKeyGenerator(req.ip)+':'+createHash('sha256').update(correoNormalizado(req.body?.correo)).digest('hex'),
    message:{error:'DEMASIADOS_INTENTOS'}})] : [];
  app.post('/api/registro', ...limites, async (req,res) => {
    const b=req.body;const correo=correoNormalizado(b?.correo);
    if (!cuerpoValido(b,['alias','correo','clave','cursoId']) ||
        typeof b.alias!=='string' || b.alias.trim().length<2 || b.alias.trim().length>60 ||
        correo.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) ||
        !claveValida(b.clave) || !Number.isSafeInteger(b.cursoId) || b.cursoId<1) {
      return res.status(422).json({error:'DATOS_INVALIDOS',mensaje:'Revisa los campos. La contraseña debe tener de 15 a 128 caracteres.'});
    }
    const curso=await pool.query('SELECT id FROM curso WHERE id=$1 AND activo',[b.cursoId]);
    if (!curso.rowCount) return res.status(422).json({error:'CURSO_INVALIDO'});
    const hash=await crearHash(b.clave);
    const cliente=await pool.connect();
    try {
      await cliente.query('BEGIN');
      const r=await cliente.query(`INSERT INTO usuario(alias,correo,hash,curso_solicitado_id)
        VALUES($1,$2,$3,$4) ON CONFLICT(correo) DO NOTHING RETURNING id`,[b.alias.trim(),correo,hash,b.cursoId]);
      if(r.rowCount) await cliente.query("INSERT INTO usuario_rol(usuario_id,rol) VALUES($1,'alumno')",[r.rows[0].id]);
      await cliente.query('COMMIT');
    } catch(e) {await cliente.query('ROLLBACK');throw e;} finally {cliente.release();}
    res.status(202).json({mensaje:'Si los datos permiten el registro, la cuenta quedará pendiente de validación docente.'});
  });
  app.post('/api/acceso', ...limites,...porCuenta, async (req,res) => {
    const b=req.body;
    if(!cuerpoValido(b,['correo','clave']) || correoNormalizado(b.correo).length>254 || !claveValida(b.clave)) {
      return res.status(401).json({error:'ACCESO_INVALIDO',mensaje:'Correo o contraseña incorrectos.'});
    }
    const r=await pool.query('SELECT id,hash,auth_version FROM usuario WHERE correo=$1',[correoNormalizado(b.correo)]);
    const u=r.rows[0];const correcta=await comprobarClave(b.clave,u?.hash ?? hashFicticio);
    if(!u || !correcta) return res.status(401).json({error:'ACCESO_INVALIDO',mensaje:'Correo o contraseña incorrectos.'});
    await regenerar(req);
    req.session.usuarioId=u.id;req.session.authVersion=u.auth_version;
    req.session.creadaEn=Date.now();req.session.csrf=token();
    await guardar(req.session);
    res.json({mensaje:'Sesión iniciada',token:req.session.csrf});
  });
  app.get('/api/yo',sesionNecesaria,(req,res) => res.json({datos:req.usuario}));
  app.use('/api',rutasAnuncios(pool,sesionNecesaria,activaNecesaria));
  app.use('/api/gestion',rutasDocentes(pool,sesionNecesaria,activaNecesaria));
  app.post('/api/salida',sesionNecesaria,async(req,res) => {
    await destruir(req);res.clearCookie('aula.sid',cookie);res.sendStatus(204);
  });
  // Conserva temporalmente el catálogo didáctico público; no son datos privados de producto.
  app.get('/api/recursos-demo',async(req,res) => {
    const texto=String(req.query.q ?? '').trim().slice(0,80);
    const r=await pool.query('SELECT id,titulo,tipo FROM recurso_demo WHERE titulo ILIKE $1 ORDER BY id',['%'+texto+'%']);
    res.json({datos:r.rows});
  });
  app.get('/api/biblioteca',sesionNecesaria,activaNecesaria,(req,res) => {
    if(!req.usuario.roles.some(r=>['alumno','docente'].includes(r))) return res.status(403).json({error:'PERMISO_INSUFICIENTE'});
    // La biblioteca real aún no se ha implementado: nunca confundir demo con catálogo final.
    res.status(501).json({error:'BIBLIOTECA_PENDIENTE_DE_IMPLEMENTAR'});
  });
  app.use(express.static(fileURLToPath(new URL('../public/',import.meta.url))));
  app.use((_req,res) => res.status(404).json({error:'NO_ENCONTRADO'}));
  app.use((error,_req,res,_next) => {
    if(error instanceof Ocupado) return res.status(503).set('Retry-After','3').json({error:'SERVIDOR_OCUPADO'});
    if(error.type==='entity.parse.failed') return res.status(400).json({error:'JSON_INVALIDO'});
    if(error.type==='entity.too.large') return res.status(413).json({error:'CUERPO_DEMASIADO_GRANDE'});
    const id=randomUUID();console.error('Error de petición',id,error.code ?? error.name);
    res.status(500).json({error:'ERROR_INTERNO',incidencia:id});
  });
  return {app,almacen};
}
