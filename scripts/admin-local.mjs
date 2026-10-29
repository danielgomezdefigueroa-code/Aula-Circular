// Preparación local separada del registro público. No cambia cuentas existentes.
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { crearHash } from '../src/claves.mjs';
if(process.env.NODE_ENV!=='development') throw new Error('Solo permitido en el laboratorio local.');
if(!['127.0.0.1','localhost'].includes(process.env.PGHOST)) throw new Error('Solo permitido contra PostgreSQL local.');
const correo='admin.ensayo@example.invalid';
const clave=randomBytes(20).toString('base64url');
const hash=await crearHash(clave);
const pool=new pg.Pool({max:1,connectionTimeoutMillis:3000});
let cliente,archivoCreado=false;
const archivo=new URL('../.admin-local.json',import.meta.url);
try{
  cliente=await pool.connect();await cliente.query('BEGIN');
  await cliente.query('SELECT pg_advisory_xact_lock(71001)');
  const curso=await cliente.query('SELECT id FROM curso WHERE activo ORDER BY id LIMIT 1');
  if(!curso.rowCount) throw new Error('No hay cursos de prueba activos.');
  const r=await cliente.query(`INSERT INTO usuario(alias,correo,hash,curso_solicitado_id,curso_confirmado_id,estado,validado_en)
    VALUES('Administrador de ensayo',$1,$2,$3,$3,'activo',now()) ON CONFLICT(correo) DO NOTHING RETURNING id`,[correo,hash,curso.rows[0].id]);
  if(!r.rowCount){
    await cliente.query('ROLLBACK');console.log('La cuenta de ensayo ya existe; no se cambia su contraseña ni sus roles.');
  }else{
    await cliente.query("INSERT INTO usuario_rol(usuario_id,rol) VALUES($1,'admin')",[r.rows[0].id]);
    await writeFile(archivo,JSON.stringify({correo,clave,nota:'Cuenta ficticia de preparación local. No subir este archivo a GitHub.'},null,2)+'\n',{flag:'wx',mode:0o600});
    archivoCreado=true;
    await cliente.query('COMMIT');
    console.log('Cuenta admin de ensayo creada. Consulta las credenciales en .admin-local.json (excluido de Git).');
  }
}catch(e){
  if(cliente) await cliente.query('ROLLBACK');
  if(archivoCreado) await unlink(archivo);
  console.error('No se pudo crear la cuenta de ensayo:',e.code ?? e.message);process.exitCode=1;
}finally{cliente?.release();await pool.end();}
