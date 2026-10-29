-- AULA CIRCULAR
-- Integración de documentos protegidos T6
-- Amplía el esquema existente sin eliminar sus tablas.

ALTER TABLE documento
ADD COLUMN estado_editorial text NOT NULL
DEFAULT 'borrador'
CHECK (estado_editorial IN (
  'borrador', 'publicado', 'retirado'
));

-- Identifica archivos privados gestionados por T6.
-- Los registros anteriores permanecen como no protegidos.
ALTER TABLE archivo
ADD COLUMN almacenamiento_privado boolean NOT NULL
DEFAULT false;

ALTER TABLE archivo
ADD COLUMN tamano_bytes bigint,
ADD COLUMN formato text,
ADD COLUMN paginas integer,
ADD COLUMN ancho integer,
ADD COLUMN alto integer;

-- Huella criptográfica para detectar alteraciones.
ALTER TABLE archivo
ADD COLUMN sha256 text;

ALTER TABLE archivo
ADD CONSTRAINT archivo_sha256_valido
CHECK (
  sha256 IS NULL
  OR sha256 ~ '^[0-9a-f]{64}$'
);

ALTER TABLE archivo
ADD CONSTRAINT archivo_tamano_valido
CHECK (
  tamano_bytes IS NULL OR
  (tamano_bytes > 0 AND tamano_bytes <= 10485760)
);

ALTER TABLE archivo
ADD CONSTRAINT archivo_formato_permitido
CHECK (
  formato IS NULL OR
  formato IN ('PDF', 'PNG', 'JPG')
);

ALTER TABLE archivo
ADD CONSTRAINT archivo_paginas_validas
CHECK (
  paginas IS NULL OR
  paginas BETWEEN 1 AND 200
);

ALTER TABLE archivo
ADD CONSTRAINT archivo_dimensiones_validas
CHECK (
  (ancho IS NULL AND alto IS NULL)
  OR
  (
    ancho > 0 AND alto > 0
    AND ancho::bigint * alto <= 12000000
  )
);

CREATE INDEX idx_documento_estado
ON documento(estado_editorial);


-- Un archivo privado debe contar con metadatos completos.
ALTER TABLE archivo
ADD CONSTRAINT archivo_privado_metadatos
CHECK (
  almacenamiento_privado = false
  OR (
    tamano_bytes IS NOT NULL
    AND formato IS NOT NULL
    AND sha256 IS NOT NULL
    AND (
      (formato = 'PDF'
        AND paginas IS NOT NULL
        AND ancho IS NULL
        AND alto IS NULL
        AND tamano_bytes <= 10485760)
      OR
      (formato IN ('PNG', 'JPG')
        AND paginas IS NULL
        AND ancho IS NOT NULL
        AND alto IS NOT NULL
        AND tamano_bytes <= 5242880)
    )
  )
);