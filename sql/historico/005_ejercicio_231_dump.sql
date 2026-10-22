--
-- PostgreSQL database dump
--

\restrict 9sRXGbw7DhKZ08rwRHCYfgUWuHIvIHGZ6fd1jHdxbf7ji2yXImFndTN5G9GHs48

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ejemplar; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ejemplar (
    id integer NOT NULL,
    recurso_id integer NOT NULL,
    codigo text NOT NULL,
    estado_servicio text DEFAULT 'habilitado'::text NOT NULL,
    CONSTRAINT ejemplar_codigo_check CHECK (((length(TRIM(BOTH FROM codigo)) >= 1) AND (length(TRIM(BOTH FROM codigo)) <= 40))),
    CONSTRAINT ejemplar_estado_servicio_check CHECK ((estado_servicio = ANY (ARRAY['habilitado'::text, 'retirado'::text])))
);


--
-- Name: ejemplar_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.ejemplar ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.ejemplar_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: operacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operacion (
    id integer NOT NULL,
    tipo text NOT NULL,
    estado text NOT NULL,
    CONSTRAINT operacion_estado_check CHECK ((estado = ANY (ARRAY['reservada'::text, 'prestada'::text, 'completada'::text, 'cancelada'::text]))),
    CONSTRAINT operacion_tipo_check CHECK ((tipo = ANY (ARRAY['prestamo'::text, 'cesion'::text, 'intercambio'::text])))
);


--
-- Name: operacion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.operacion ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.operacion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: operacion_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operacion_item (
    operacion_id integer NOT NULL,
    ejemplar_id integer NOT NULL
);


--
-- Name: recurso; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recurso (
    id integer NOT NULL,
    titulo text NOT NULL,
    estado_editorial text DEFAULT 'publicado'::text NOT NULL,
    CONSTRAINT recurso_estado_editorial_check CHECK ((estado_editorial = ANY (ARRAY['publicado'::text, 'retirado'::text]))),
    CONSTRAINT recurso_titulo_check CHECK (((length(TRIM(BOTH FROM titulo)) >= 1) AND (length(TRIM(BOTH FROM titulo)) <= 120)))
);


--
-- Name: recurso_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.recurso ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.recurso_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: reserva_activa; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reserva_activa (
    ejemplar_id integer NOT NULL,
    operacion_id integer NOT NULL
);


--
-- Data for Name: ejemplar; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ejemplar (id, recurso_id, codigo, estado_servicio) FROM stdin;
1	1	EJ03	habilitado
2	1	EJ04	habilitado
3	1	EJ09	habilitado
\.


--
-- Data for Name: operacion; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.operacion (id, tipo, estado) FROM stdin;
1	prestamo	prestada
2	prestamo	completada
\.


--
-- Data for Name: operacion_item; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.operacion_item (operacion_id, ejemplar_id) FROM stdin;
1	2
2	1
\.


--
-- Data for Name: recurso; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.recurso (id, titulo, estado_editorial) FROM stdin;
1	Manual de SQL	publicado
\.


--
-- Data for Name: reserva_activa; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.reserva_activa (ejemplar_id, operacion_id) FROM stdin;
2	1
\.


--
-- Name: ejemplar_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ejemplar_id_seq', 3, true);


--
-- Name: operacion_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.operacion_id_seq', 2, true);


--
-- Name: recurso_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.recurso_id_seq', 1, true);


--
-- Name: ejemplar ejemplar_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ejemplar
    ADD CONSTRAINT ejemplar_codigo_key UNIQUE (codigo);


--
-- Name: ejemplar ejemplar_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ejemplar
    ADD CONSTRAINT ejemplar_pkey PRIMARY KEY (id);


--
-- Name: operacion_item operacion_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operacion_item
    ADD CONSTRAINT operacion_item_pkey PRIMARY KEY (operacion_id, ejemplar_id);


--
-- Name: operacion operacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operacion
    ADD CONSTRAINT operacion_pkey PRIMARY KEY (id);


--
-- Name: recurso recurso_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurso
    ADD CONSTRAINT recurso_pkey PRIMARY KEY (id);


--
-- Name: reserva_activa reserva_activa_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reserva_activa
    ADD CONSTRAINT reserva_activa_pkey PRIMARY KEY (ejemplar_id);


--
-- Name: ejemplar ejemplar_recurso_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ejemplar
    ADD CONSTRAINT ejemplar_recurso_id_fkey FOREIGN KEY (recurso_id) REFERENCES public.recurso(id);


--
-- Name: operacion_item operacion_item_ejemplar_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operacion_item
    ADD CONSTRAINT operacion_item_ejemplar_id_fkey FOREIGN KEY (ejemplar_id) REFERENCES public.ejemplar(id);


--
-- Name: operacion_item operacion_item_operacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operacion_item
    ADD CONSTRAINT operacion_item_operacion_id_fkey FOREIGN KEY (operacion_id) REFERENCES public.operacion(id);


--
-- Name: reserva_activa reserva_activa_ejemplar_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reserva_activa
    ADD CONSTRAINT reserva_activa_ejemplar_id_fkey FOREIGN KEY (ejemplar_id) REFERENCES public.ejemplar(id);


--
-- Name: reserva_activa reserva_activa_operacion_id_ejemplar_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reserva_activa
    ADD CONSTRAINT reserva_activa_operacion_id_ejemplar_id_fkey FOREIGN KEY (operacion_id, ejemplar_id) REFERENCES public.operacion_item(operacion_id, ejemplar_id);


--
-- PostgreSQL database dump complete
--

\unrestrict 9sRXGbw7DhKZ08rwRHCYfgUWuHIvIHGZ6fd1jHdxbf7ji2yXImFndTN5G9GHs48

