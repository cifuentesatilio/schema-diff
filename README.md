# MySQL Schema Diff

Herramienta de análisis estructural para comparar esquemas de bases de datos MySQL entre ambientes (DEV, QA, Producción). Todo el procesamiento ocurre localmente en el navegador — ningún archivo SQL es enviado a servidores externos.

---

## Características

- Comparación de tablas, columnas, índices, constraints, vistas, stored procedures, functions y triggers
- Detección de objetos nuevos, eliminados, modificados y renombrados
- Matching semántico de índices (detecta renombrados por columnas indexadas)
- Comparación de cuerpo de stored procedures y functions
- Filtros por base de datos, lado y búsqueda de texto
- 100% local — sin backend, sin APIs externas, sin telemetría

---

## Requisitos

| Herramienta | Versión mínima |
|---|---|
| Node.js | 18.x o superior |
| npm | 9.x o superior |
| Angular CLI | 21.x |

---

## Instalación
```bash
# Clonar el repositorio
git clone https://github.com/tu-org/schema-diff.git
cd schema-diff

# Instalar dependencias
npm install

# Iniciar en modo desarrollo
ng serve
```

Abrir en el navegador: `http://localhost:4200`

---

## Uso

### 1. Exportar los esquemas desde MySQL

Conectado a cada ambiente, ejecuta el siguiente comando para cada servidor:
```bash
mysqldump --no-data \
  --set-gtid-purged=OFF \
  --single-transaction \
  --routines \
  --triggers \
  --databases db1 db2 db3 \
  -h host \
  -u usuario \
  -p | sed "s/ COMMENT '[^']*'//g" > ambiente.sql
```

Flags importantes:

| Flag | Descripción |
|---|---|
| `--no-data` | Solo exporta estructura, sin datos |
| `--routines` | Incluye stored procedures y functions |
| `--triggers` | Incluye triggers |
| `--set-gtid-purged=OFF` | Evita warnings de GTID en RDS |
| `--single-transaction` | Dump consistente sin lockear tablas |
| `sed "s/ COMMENT '[^']*'//g"` | Elimina COMMENTs para comparación limpia |

### 2. Comparar

1. Abre `http://localhost:4200`
2. Arrastra o selecciona el archivo `.sql` del ambiente A (ej. DEV)
3. Arrastra o selecciona el archivo `.sql` del ambiente B (ej. QA)
4. Ajusta los nombres de ambiente si es necesario
5. Haz click en **Comparar Esquemas**

### 3. Interpretar resultados

| Badge | Significado |
|---|---|
| `NUEVA / NUEVO` | El objeto existe solo en ese ambiente |
| `ELIMINADA / ELIMINADO` | El objeto fue eliminado en ese ambiente |
| `MODIFICADA / MODIFICADO` | El objeto existe en ambos pero con diferencias |
| `AGREGADA / AGREGADO` | Columna que existe solo en ese ambiente |
| `RENOMBRADO` | Mismo objeto con diferente nombre (detectado por contenido) |

Los filtros permiten acotar por base de datos, por lado (DEV/QA/AMBOS) y por texto libre.

---

## Estructura del proyecto
## Estructura del proyecto
```
schema-diff/
├── infra/
│   └── docker/
│       ├── Dockerfile         # Build multistage: Node (build) + Nginx (serve)
│       ├── docker-compose.yml # Configuración del contenedor
│       ├── nginx.conf         # Configuración de Nginx
│       └── .dockerignore      # Archivos excluidos del build
├── src/
│   ├── app/
│   │   ├── core/
│   │   │   ├── models/
│   │   │   │   └── schema.models.ts          # Interfaces y tipos
│   │   │   └── services/
│   │   │       └── schema-parser.service.ts  # Parser y comparador
│   │   ├── features/
│   │   │   └── diff/
│   │   │       ├── diff.component.ts         # Lógica del componente
│   │   │       ├── diff.component.html       # Template
│   │   │       └── diff.component.scss       # Estilos
│   │   ├── app.ts                            # Componente raíz
│   │   ├── app.config.ts                     # Configuración Angular
│   │   └── app.scss                          # Estilos globales
│   ├── index.html
│   └── main.ts
├── .gitignore
├── angular.json
├── package.json
└── README.md
```
---

## Seguridad

### Procesamiento local
Todo el análisis ocurre en el navegador del usuario. Los archivos SQL nunca son enviados a ningún servidor externo.

### Validaciones implementadas
- Solo se aceptan archivos con extensión `.sql`
- Tamaño máximo por archivo: 50MB
- Validación de contenido mínimo esperado en un dump MySQL

### Content Security Policy
El archivo `index.html` incluye un meta tag CSP que bloquea cualquier conexión de red saliente:
```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self';
           style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
           font-src 'self' https://fonts.gstatic.com;
           img-src 'self' data:;
           script-src 'self';
           connect-src 'none';">
```

### Archivos SQL
Los archivos `.sql` están en `.gitignore` para evitar que esquemas de base de datos sean commiteados accidentalmente al repositorio.

### Si en el futuro se despliega en servidor
Agregar los siguientes headers HTTP en Nginx o CloudFront:
```nginx
add_header X-Frame-Options "DENY";
add_header X-Content-Type-Options "nosniff";
add_header Referrer-Policy "no-referrer";
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()";
```

---

## Build para producción
```bash
ng build
```

Los archivos generados quedan en `dist/schema-diff/browser/`. Son archivos estáticos que pueden ser servidos desde cualquier servidor web (Nginx, Apache, S3, etc.).

---

## Limitaciones conocidas

- Los stored procedures y functions se comparan como texto normalizado. Diferencias de formato (espacios, saltos de línea) pueden generar falsos positivos
- El matching semántico de índices renombrados funciona por firma de columnas. Índices compuestos con las mismas columnas en diferente orden se reportan como distintos
- Archivos mayores a 50MB pueden impactar el rendimiento del navegador

---

## Contribuir

1. Haz fork del repositorio
2. Crea una rama: `git checkout -b feature/nombre-feature`
3. Commitea tus cambios: `git commit -m 'feat: descripción'`
4. Push a la rama: `git push origin feature/nombre-feature`
5. Abre un Pull Request

---

## Docker

La aplicación está configurada para correr en un contenedor Docker con Nginx. Los archivos de configuración están en `infra/docker/`.

### Requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### Estructura
```
infra/
└── docker/
    ├── Dockerfile         # Build multistage: Node (build) + Nginx (serve)
    ├── docker-compose.yml # Configuración del contenedor
    ├── nginx.conf         # Configuración de Nginx
    └── .dockerignore      # Archivos excluidos del build
```

### Levantar el contenedor
```bash
cd infra/docker

# Primera vez o cuando hay cambios en el código
docker compose up --build -d

# Sin cambios en el código
docker compose up -d
```

Abre `http://localhost:8080` en el navegador.

### Comandos útiles
```bash
# Ver estado del contenedor
docker compose ps

# Ver logs
docker compose logs

# Detener
docker compose stop

# Detener y eliminar el contenedor
docker compose down
```

### Detalles del contenedor

| Parámetro | Valor |
|---|---|
| Nombre del contenedor | `mysql-schema-diff` |
| Nombre de la imagen | `mysql-schema-diff` |
| Puerto | `8080` |
| Política de reinicio | `unless-stopped` |

> El contenedor se reinicia automáticamente si se cae o cuando Docker Desktop inicia.

----

## Tecnologías

- [Angular 21](https://angular.dev) — framework frontend
- [TypeScript 5.9](https://www.typescriptlang.org) — lenguaje
- [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) — tipografía
