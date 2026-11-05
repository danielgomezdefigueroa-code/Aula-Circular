from pathlib import Path
import subprocess,hashlib,json
out=Path(__file__).resolve().parent;repo=out.parents[2]
ref='fe1d34f'
runtime=out/'.runtime';runtime.mkdir(parents=True,exist_ok=True)
files=subprocess.check_output(['git','ls-tree','-rz','--name-only',ref,'src','sql/migraciones','public'],cwd=repo).decode('utf-8').rstrip('\0').split('\0')
hashes={}
for name in files:
 data=subprocess.check_output(['git','show',f'{ref}:{name}'],cwd=repo)
 target=runtime/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
 if name.startswith('public/'):
  for version in ['antes','despues']:
   dest=out/version/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
  hashes[name]=hashlib.sha256(data).hexdigest()
css=out/'antes/public/css/estilo.css'
css.write_bytes(css.read_bytes()+b'\n/* FALLO DIDACTICO PREPARADO: no pertenece al proyecto original. */\n:focus, :focus-visible { outline: none !important; box-shadow: none !important; }\n')
(out/'origen.json').write_text(json.dumps({'base':ref,'rama':'origin/interfaz-y-accesibilidad','tipo':'copia de ensayo; no modifica archivos del proyecto','fuentes_sha256':hashes},indent=2),encoding='utf-8')
print(runtime)
