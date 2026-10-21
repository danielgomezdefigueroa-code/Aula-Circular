// Fechas de calendario del centro, independientes de la zona del ordenador.

export function hoyMadrid(instante = new Date()) {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instante);

  const valor = tipo => partes.find(parte => parte.type === tipo).value;
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

export function fechaValida(texto) {
  if (typeof texto !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(texto) ||
      texto.startsWith('0000')) {
    return false;
  }

  const fecha = new Date(`${texto}T00:00:00.000Z`);

  // La comparación impide aceptar fechas como el 30 de febrero.
  return Number.isFinite(fecha.getTime()) &&
    fecha.toISOString().slice(0, 10) === texto;
}

export function vencimientoValido(texto, hoy = hoyMadrid()) {
  return fechaValida(texto) && texto > hoy;
}

export function proponerVencimiento(hoy = hoyMadrid()) {
  if (!fechaValida(hoy)) {
    throw new Error('Fecha inicial no válida');
  }

  // UTC se usa solo para sumar días de calendario, sin cambios de horario.
  const fecha = new Date(`${hoy}T00:00:00.000Z`);
  fecha.setUTCDate(fecha.getUTCDate() + 14);
  return fecha.toISOString().slice(0, 10);
}