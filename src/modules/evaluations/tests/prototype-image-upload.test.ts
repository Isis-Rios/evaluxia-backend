import fs from 'fs';
import {
  detectImageFormat,
  prototypeImageUploadService,
  PROTOTYPE_IMAGE_MAX_BYTES,
} from '@/modules/evaluations/services/prototype-image-upload.service';

/**
 * P1 — Upload seguro de la imagen de prototipo.
 */

// 1x1 PNG — real binary fixture, usada SOLO para el caso "demasiado pequeña"
// (por debajo del mínimo de dimensiones).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
// 64x64 — fixtures VÁLIDAS reales (generadas con `sips`/`cwebp` a partir del
// mismo píxel, re-escaladas a un tamaño que supera el mínimo de dimensiones).
const PNG_64 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAQKADAAQAAAABAAAAQAAAAABGUUKwAAAAX0lEQVR4Ae3QAQ0AAADCoPdPbQ43iEBhwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMvA8MQEAAARZBmOsAAAAASUVORK5CYII=',
  'base64',
);
const JPEG_64 = Buffer.from(
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAQKADAAQAAAABAAAAQAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAQABAAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQABP/aAAwDAQACEQMRAD8A/n/ooooAKKKKACiiigAooooA/9D+f+iiigAooooAKKKKACiiigD/0f5/6KKKACiiigAooooAKKKKAP/S/n/ooooAKKKKACiiigAooooA/9k=',
  'base64',
);
const WEBP_64 = Buffer.from(
  'UklGRmQAAABXRUJQVlA4WAoAAAAQAAAAPwAAPwAAQUxQSA8AAAABBxAREQASwv/3WkT/Uz8AVlA4IC4AAACQAwCdASpAAEAAPpFIoEwlpCMiIggAsBIJaQAAEDdTUAV4hbkAAP74zvV4AAAA',
  'base64',
);

function runTests() {
  console.log('🧪 Starting Prototype Image Upload (P1) Tests...\n');
  let passed = 0;
  let failed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) { console.log(`  ✅ ${msg}`); passed++; } else { console.error(`  ❌ FAILED: ${msg}`); failed++; }
  }

  // 1. Detección de formato por firma binaria
  assert(detectImageFormat(PNG_64) === 'png', 'PNG real es detectado por su firma binaria');
  assert(detectImageFormat(JPEG_64) === 'jpeg', 'JPEG real es detectado por su firma binaria');
  assert(detectImageFormat(WEBP_64) === 'webp', 'WEBP real es detectado por su firma binaria');

  // 2. MIME/extensión incorrectos nunca importan -- la firma manda
  const fakeSvgAsPng = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert(detectImageFormat(fakeSvgAsPng) === null, 'Un SVG (aunque declarado como PNG) es rechazado -- firma binaria real no coincide');

  const fakeGif = Buffer.from('GIF89a');
  assert(detectImageFormat(fakeGif) === null, 'Un GIF nunca es reconocido como formato válido (excluido por diseño)');

  // 3. store() — PNG válido se persiste correctamente
  const stored = prototypeImageUploadService.store({ buffer: PNG_64, size: PNG_64.length, originalname: '../../evil.png' });
  assert(stored.format === 'png', 'store() detecta PNG correctamente');
  assert(stored.url.startsWith('/uploads/prototypes/'), 'store() genera una URL bajo /uploads/prototypes/ (ruta aislada)');
  assert(!stored.url.includes('evil') && !stored.url.includes('..'), 'El nombre físico NUNCA deriva del originalname del cliente (UUID seguro, sin path traversal)');
  assert(fs.existsSync(stored.absolutePath), 'El archivo fue realmente escrito a disco');
  assert(stored.width === 64 && stored.height === 64, 'store() reporta las dimensiones reales (64x64)');
  fs.unlinkSync(stored.absolutePath);

  // 4. JPEG y WEBP válidos también se aceptan
  const storedJpeg = prototypeImageUploadService.store({ buffer: JPEG_64, size: JPEG_64.length });
  assert(storedJpeg.format === 'jpeg' && storedJpeg.url.endsWith('.jpg'), 'store() acepta JPEG y usa extensión .jpg');
  fs.unlinkSync(storedJpeg.absolutePath);

  const storedWebp = prototypeImageUploadService.store({ buffer: WEBP_64, size: WEBP_64.length });
  assert(storedWebp.format === 'webp', 'store() acepta WEBP');
  fs.unlinkSync(storedWebp.absolutePath);

  // 5. MIME incorrecto / firma incorrecta -> rechazado
  let rejectedFakeFormat = false;
  try {
    prototypeImageUploadService.store({ buffer: fakeSvgAsPng, size: fakeSvgAsPng.length, originalname: 'image.png' });
  } catch {
    rejectedFakeFormat = true;
  }
  assert(rejectedFakeFormat, 'store() rechaza un archivo cuya firma binaria real no es PNG/JPEG/WEBP, sin importar el nombre declarado');

  // 6. Tamaño excedido
  let rejectedOversize = false;
  try {
    prototypeImageUploadService.store({ buffer: PNG_64, size: PROTOTYPE_IMAGE_MAX_BYTES + 1 });
  } catch {
    rejectedOversize = true;
  }
  assert(rejectedOversize, 'store() rechaza un archivo cuyo tamaño (reportado por multer) excede PROTOTYPE_IMAGE_MAX_BYTES');

  // 7. Dimensiones inválidas (demasiado pequeña: la fixture 1x1 es menor al mínimo)
  let rejectedTooSmall = false;
  try {
    prototypeImageUploadService.store({ buffer: PNG_1X1, size: PNG_1X1.length });
  } catch {
    rejectedTooSmall = true;
  }
  assert(rejectedTooSmall, 'store() rechaza una imagen por debajo de las dimensiones mínimas permitidas (1x1 < 50x50)');

  // 8. Buffer vacío
  let rejectedEmpty = false;
  try {
    prototypeImageUploadService.store({ buffer: Buffer.alloc(0), size: 0 });
  } catch {
    rejectedEmpty = true;
  }
  assert(rejectedEmpty, 'store() rechaza un buffer vacío');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests();
