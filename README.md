# Control de Stock POS

Sistema de punto de venta (POS) de mostrador y control de inventario **100 % offline** para comercios pequeños. Está construido con Electron, SQLite y JavaScript sin frameworks: todos los datos viven en una base local y la aplicación bloquea cualquier petición de red.

## Funcionalidades

- **Turnos y usuarios**: inicio de sesión por trabajador con PIN o contraseña (hash scrypt), roles `admin` y `vendedor`, y bloqueo de pantalla al cerrar turno.
- **Punto de venta**: catálogo por categorías y búsqueda, carrito con control de stock disponible, pago en efectivo, tarjeta u otro, cálculo de cambio y ticket de venta.
- **Inventario**: alta, edición y baja de productos; SKU, categoría, stock mínimo y alertas; ajustes manuales auditados; importación desde JSON y carga de datos de ejemplo.
- **Ventas y auditoría**: historial de tickets por turno, anulación con devolución automática de unidades y Kardex completo de cada movimiento de stock.
- **Copias de seguridad**: exportación y restauración atómica de la base `.db`, además de exportación a Excel (`.xlsx`) de inventario, ventas y Kardex.
- **Interfaz**: en español, tema claro/oscuro, atajos de teclado y tipografías empaquetadas para funcionar sin conexión.

## Tecnologías

- Electron 45 (proceso principal + preload + renderer)
- SQLite vía `better-sqlite3` en modo WAL con claves foráneas activas
- HTML, CSS y JavaScript vanilla, sin bundler ni framework

La seguridad se apoya en `contextIsolation`, `sandbox`, CSP estricta, una API mínima expuesta por `contextBridge` y verificación de sesión y rol en cada canal IPC. Las credenciales se guardan con `scrypt` y comparación en tiempo constante.

## Requisitos

- Node.js 20 o superior
- npm 10 o superior

## Puesta en marcha

```bash
npm install
npm start
```

Prueba de integración (base de datos temporal, sin tocar datos reales):

```bash
npm test
```

## Compilación

```bash
npm run dist   # portable + instalador NSIS para Windows x64 en dist/
npm run pack   # carpeta desempaquetada para pruebas
```

La configuración de empaquetado está en `electron-builder.yml`. El ejecutable portable y el instalador se generan en `dist/` (ignorada por Git).

## Primer acceso

En la primera ejecución se crean dos usuarios de ejemplo:

| Usuario | Código | PIN |
| --- | --- | --- |
| Administrador | `ADM-001` | `1234` |
| Vendedor Turno 1 | `VEN-001` | `0000` |

Cambia ambas credenciales desde el módulo **Trabajadores** antes de usar la aplicación en producción. Los PIN de ejemplo solo se siembran cuando la base está vacía.

## Datos y copias de seguridad

La base de datos se guarda como `pos_inventory.db` dentro de la carpeta `userData` de Electron (por defecto `%APPDATA%` en Windows). Se puede sobreescribir la ruta con la variable de entorno `POS_DB_PATH`, útil para pruebas.

La aplicación incluye exportación/restauración de la base completa y exportación a Excel. Para un comercio real, programa copias periódicas en una unidad externa.

## Estructura del proyecto

```text
src/main/          Proceso principal: ventana, seguridad, IPC, backups
src/main/db/       Conexión SQLite, esquema y repositorios
src/preload/       Puente seguro entre renderer y main
src/renderer/      Interfaz (HTML, CSS, JS por vistas)
tests/             Prueba de integración del flujo POS
Control_de_Stock.html  Prototipo legado autónomo (localStorage), solo referencia
```

`Control_de_Stock.html` es la versión anterior de un solo archivo, conservada como referencia. No forma parte del ejecutable empaquetado.

## Licencia

MIT
