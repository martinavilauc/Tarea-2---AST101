// ============================================================
// 1. Configuración de la escena 3D
// ============================================================
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 8000);
const renderer = new THREE.WebGLRenderer({ antialias: true });

renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0); // el baricentro (origen de las coordenadas) queda como centro de órbita de la cámara
camera.position.set(0, 55, 85);

// Luz: el Sol se dibuja con MeshBasicMaterial (autoiluminado, no necesita luz).
// Los planetas usan MeshStandardMaterial para que se vean con volumen (lado
// iluminado / lado oscuro), así que necesitan una fuente de luz real. Se
// agrega una luz puntual en el origen del Sol (se reposiciona más abajo,
// una vez que sabemos su posición real) y una luz ambiental tenue para que
// el lado oscuro no quede 100% negro.
const luzSol = new THREE.PointLight(0xffffff, 2.2, 0, 0.4);
luzSol.position.set(0, 0, 0);
scene.add(luzSol);
scene.add(new THREE.AmbientLight(0x404040, 0.8));

// Fondo estrellado simple, solo estético.
function crearEstrellas() {
    const cantidad = 1500;
    const posiciones = new Float32Array(cantidad * 3);
    for (let idx = 0; idx < cantidad; idx++) {
        const radio = 1200 + Math.random() * 800;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        posiciones[idx * 3] = radio * Math.sin(phi) * Math.cos(theta);
        posiciones[idx * 3 + 1] = radio * Math.cos(phi);
        posiciones[idx * 3 + 2] = radio * Math.sin(phi) * Math.sin(theta);
    }
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute('position', new THREE.BufferAttribute(posiciones, 3));
    const material = new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false });
    scene.add(new THREE.Points(geometria, material));
}
crearEstrellas();

// ============================================================
// 2. Escala de distancias: dos modos conmutables
// ============================================================
// Con 1 unidad = X km fijo (escala real, lineal), Mercurio (~58 millones de
// km) y Neptuno (~4.500 millones de km) quedan en una proporción de ~77:1.
// Eso obliga a elegir entre ver bien los planetas interiores (y perder a
// Urano/Neptuno fuera de cámara) o alejar tanto la cámara que Mercurio-Marte
// quedan pegados al marcador del baricentro y se confunden con él.
//
// Por eso hay dos modos, elegibles desde el panel de configuración:
//
// - "real" (por defecto): distancia visual = distancia_km / KM_POR_UNIDAD_REAL,
//   una simple división lineal. Es la proporción real entre órbitas, pero
//   para verla completa hay que alejar mucho la cámara (los planetas
//   interiores se ven todos amontonados cerca del Sol).
//
// - "exagerada": distancia visual = UNIDADES_POR_RAIZ_UA * sqrt(distancia_en_UA).
//   La raíz cuadrada comprime las distancias grandes mucho más que las
//   chicas, así el orden y la separación relativa entre planetas se
//   mantiene, pero la relación interior/exterior baja de 77:1 a menos de
//   9:1 y los 9 cuerpos entran en una sola vista sin mover la cámara. Ya no
//   son distancias reales.
const KM_POR_UA = 149597870.7;
const UNIDADES_POR_RAIZ_UA = 14;
const KM_POR_UNIDAD_REAL = 4000000;

let modoEscala = 'real'; // 'real' | 'exagerada'

function escalarDistancia(distanciaKm) {
    if (modoEscala === 'real') {
        return distanciaKm / KM_POR_UNIDAD_REAL;
    }
    const distanciaUA = distanciaKm / KM_POR_UA;
    return UNIDADES_POR_RAIZ_UA * Math.sqrt(distanciaUA);
}

// Factor lineal único que, aplicado a TODO lo que pertenece a un mismo
// planeta (su posición instantánea Y el aro de su órbita), garantiza que el
// planeta quede dibujado sobre su propio aro: se calcula una sola vez a
// partir del semieje mayor real de ESE planeta, y se reutiliza tanto para
// la posición (coordenadas XYZ instantáneas) como para generar la elipse.
function factorEscalaOrbita(semiejeMayorKm) {
    return escalarDistancia(semiejeMayorKm) / semiejeMayorKm;
}

// ============================================================
// 2b. Escala de tamaño: eje independiente de la escala de distancias
// ============================================================
// "real": el radio visual es proporcional al radio real del cuerpo, usando
// la MISMA conversión km->unidades que la escala de distancia real
// (KM_POR_UNIDAD_REAL), sin importar qué escala de distancia esté activa.
// Así, cuando ambas escalas están en "real" (el modo por defecto), tamaño y
// distancia son coherentes entre sí a la misma proporción física real.
// Con esta escala la Tierra mide ~0.0016 unidades: prácticamente invisible,
// que es exactamente lo que pasa en la realidad comparado con la distancia
// entre planetas. Por eso existe el wireframe de resaltado al pasar el
// mouse y una zona de click más grande que el cuerpo (ver más abajo).
//
// "exagerada": usa el radio elegido a mano en main.py (radio_exagerado),
// para que los cuerpos sean visibles sin necesidad de acercar la cámara.
let modoTamano = 'real'; // 'real' | 'exagerada'

function calcularRadioVisual(datos) {
    if (modoTamano === 'real') {
        return datos.radio_km / KM_POR_UNIDAD_REAL;
    }
    return datos.radio_exagerado;
}

// Radio mínimo (en unidades de escena) de la zona clickeable de un cuerpo,
// sin importar cuán chico sea su radio visual real. Sin esto, en escala de
// tamaño real sería casi imposible acertarle a un planeta con el mouse.
const RADIO_MINIMO_CLIC = 0.35;

// Radio mínimo del wireframe (solo visual, no afecta el click), para que
// siga siendo visible aunque el radio real del cuerpo sea sub-píxel.
const RADIO_MINIMO_WIREFRAME = 0.07;

// Radio de la zona clickeable: SIEMPRE se calcula a partir del radio
// exagerado del cuerpo (nunca del real), así que no cambia según el modo de
// tamaño elegido — clickear un planeta es igual de fácil en "real" que en
// "exagerada".
function calcularRadioHitbox(datos) {
    return Math.max(datos.radio_exagerado * 1.3, RADIO_MINIMO_CLIC);
}

// Radio del wireframe: sí sigue al radio visual actual (real o exagerado),
// para que se note el cambio de tamaño al alternar el modo. Tiene su propio
// piso, más chico que el del hitbox, para no ocultar que el cuerpo real es
// diminuto pero sin volverse invisible.
function calcularRadioWireframe(radioVisual) {
    return Math.max(radioVisual * 1.3, RADIO_MINIMO_WIREFRAME);
}

// Para el Sol y el baricentro (a diferencia de los demás planetas) el
// hitbox/wireframe SÍ sigue de cerca al radio visual actual (factor 1.5,
// con piso mínimo), en vez de quedar fijo al radio exagerado: ambos son
// "puntos únicos" de referencia en el centro de la escena, así que conviene
// que su zona interactiva se ciña a su tamaño real en pantalla en vez de
// quedar con un halo desproporcionado.
function calcularRadioAjustado(radioBase, minimo) {
    return Math.max(radioBase * 1.5, minimo);
}

// ============================================================
// 3. Geometría orbital real (usa TODOS los elementos que entrega
//    Cliente_JPL_Horizons.pedir_elementos_orbitales, no solo a/e)
// ============================================================
// Rotación estándar del plano perifocal (plano de la propia órbita) al
// plano de referencia (eclíptica), usando inclinación (i), longitud del
// nodo ascendente (Ω) y argumento del perihelio (w). Es la misma
// transformación que usa JPL Horizons/Vallado para pasar de elementos
// orbitales a vectores de posición, así que el aro queda coherente con las
// coordenadas XYZ reales que ya entrega la API.
function perifocalAEclipica(xPf, yPf, incDeg, nodoDeg, argPeriDeg) {
    const i = incDeg * Math.PI / 180;
    const om = nodoDeg * Math.PI / 180;
    const w = argPeriDeg * Math.PI / 180;

    const cosO = Math.cos(om), sinO = Math.sin(om);
    const cosI = Math.cos(i), sinI = Math.sin(i);
    const cosW = Math.cos(w), sinW = Math.sin(w);

    const r11 = cosO * cosW - sinO * sinW * cosI;
    const r12 = -cosO * sinW - sinO * cosW * cosI;
    const r21 = sinO * cosW + cosO * sinW * cosI;
    const r22 = -sinO * sinW + cosO * cosW * cosI;
    const r31 = sinW * sinI;
    const r32 = cosW * sinI;

    return {
        x: r11 * xPf + r12 * yPf,
        y: r21 * xPf + r22 * yPf,
        z: r31 * xPf + r32 * yPf,
    };
}

// Construye el aro de órbita a partir de los elementos reales (excentricidad,
// semieje mayor, inclinación, nodo ascendente y argumento del perihelio).
function crearLineaOrbita(elementos, color) {
    const aKm = elementos.semieje_mayor_km;
    const e = elementos.excentricidad;
    const factor = factorEscalaOrbita(aKm);

    const segmentos = 180;
    const puntos = [];
    for (let s = 0; s <= segmentos; s++) {
        const nu = (s / segmentos) * 2 * Math.PI; // anomalía verdadera
        const rKm = (aKm * (1 - e * e)) / (1 + e * Math.cos(nu)); // ecuación polar de la elipse (foco = Sol/baricentro)
        const xPf = rKm * Math.cos(nu);
        const yPf = rKm * Math.sin(nu);

        const eclip = perifocalAEclipica(
            xPf, yPf,
            elementos.inclinacion_deg,
            elementos.nodo_ascendente_deg,
            elementos.arg_perihelio_deg,
        );

        // Mismo mapeo de ejes que la posición del planeta (ver más abajo):
        // X real -> x escena, Z real -> y escena (altura), Y real -> z escena.
        puntos.push(new THREE.Vector3(eclip.x * factor, eclip.z * factor, eclip.y * factor));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(puntos);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4 });
    return new THREE.Line(geometry, material);
}

// ============================================================
// 4. Marcador del baricentro
// ============================================================
// Lista de objetos clickeables/resaltables: { meshRaycast, wireframe,
// nombre, datos }. "meshRaycast" es el mesh (invisible para los cuerpos, o
// el propio marcador para el baricentro) contra el que se hace raycasting;
// "wireframe" es el aro que se enciende al pasar el mouse por encima.
// "datos" es el objeto que devuelve la API (color, radios, coordenadas,
// elementos orbitales) para Sol/planetas, o null para el baricentro (no es
// un cuerpo físico, no tiene esos datos). El baricentro se agrega una sola
// vez acá; los cuerpos (Sol + planetas) se agregan/quitan en
// construirCuerpos()/limpiarCuerpos() cada vez que cambia la escala o la
// fecha consultada.
const cuerposInteractivos = [];
// Meshes, marcadores y líneas de órbita de los cuerpos (sin el marcador del
// baricentro, las estrellas ni las luces), para poder sacarlos de la escena
// al cambiar de escala/fecha sin tener que volver a pedir datos a la API.
const objetosCuerpos = [];

// Radio visual del marcador del baricentro: un tercio del tamaño original (0.25 -> ~0.083).
const RADIO_BARICENTRO = 0.25 / 3;

const marcadorBaricentro = new THREE.Mesh(
    new THREE.SphereGeometry(RADIO_BARICENTRO, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
);
marcadorBaricentro.position.set(0, 0, 0);
scene.add(marcadorBaricentro);

// Hitbox invisible propio (más grande que el marcador visual, con el mismo
// piso mínimo que usan los demás cuerpos), para que seguir siendo fácil de
// clickear pese a que el marcador visual ahora es bastante más chico.
const hitboxBaricentro = new THREE.Mesh(
    new THREE.SphereGeometry(calcularRadioAjustado(RADIO_BARICENTRO, RADIO_MINIMO_CLIC), 16, 16),
    new THREE.MeshBasicMaterial({ visible: false })
);
hitboxBaricentro.position.set(0, 0, 0);
scene.add(hitboxBaricentro);

const wireframeBaricentro = new THREE.Mesh(
    new THREE.SphereGeometry(calcularRadioAjustado(RADIO_BARICENTRO, RADIO_MINIMO_WIREFRAME), 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.9 })
);
wireframeBaricentro.visible = false;
scene.add(wireframeBaricentro);

cuerposInteractivos.push({
    meshRaycast: hitboxBaricentro,
    wireframe: wireframeBaricentro,
    nombre: "Baricentro del Sistema Solar",
    datos: null,
});

// ============================================================
// 5. Consultar datos al backend y renderizar planetas (incluido el Sol)
// ============================================================
const elCargando = document.getElementById('cargando');
const elBannerError = document.getElementById('banner-error');

function mostrarError(mensaje) {
    elBannerError.textContent = mensaje;
    elBannerError.style.display = 'block';
}

// Datos crudos de la última consulta exitosa a la API, guardados para poder
// reconstruir la escena al cambiar de escala sin volver a pedirlos.
let ultimosCuerpos = null;

// Quita de la escena los meshes/marcadores/líneas de cuerpos dibujados
// anteriormente (deja intactos el marcador del baricentro, las estrellas y
// las luces).
function limpiarCuerpos() {
    objetosCuerpos.forEach(obj => {
        scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
    });
    objetosCuerpos.length = 0;

    // cuerposInteractivos conserva solo la entrada del baricentro.
    cuerposInteractivos.length = 0;
    cuerposInteractivos.push({
        meshRaycast: hitboxBaricentro,
        wireframe: wireframeBaricentro,
        nombre: "Baricentro del Sistema Solar",
        datos: null,
    });

    // Evita referencias colgantes a wireframes de cuerpos que se acaban de eliminar.
    wireframeActivo = null;
}

// Dibuja el Sol y los planetas a partir de los datos ya recibidos de la API,
// usando el modoEscala/modoTamano actuales. Se puede llamar varias veces
// (p. ej. al cambiar de escala) sin volver a consultar el backend.
function construirCuerpos(cuerpos) {
    let distanciaVisualMaxima = 0;

    Object.keys(cuerpos).forEach(nombre => {
        const data = cuerpos[nombre];
        const coords = data.coordenadas;
        const elementos = data.elementos_orbitales; // null para el Sol (o si Horizons no los pudo leer)
        const esSol = nombre === "Sol";
        const radioVisual = calcularRadioVisual(data);

        // Mesh visual: lo que realmente se ve. En escala de tamaño real
        // puede terminar siendo sub-píxel (p. ej. la Tierra), y eso es
        // intencional: así de chicos son los planetas comparados con las
        // distancias reales entre ellos.
        const geo = new THREE.SphereGeometry(radioVisual, 32, 32);
        const mat = esSol
            ? new THREE.MeshBasicMaterial({ color: data.color })
            : new THREE.MeshStandardMaterial({ color: data.color, roughness: 0.9, metalness: 0 });
        const mesh = new THREE.Mesh(geo, mat);

        // Factor de escala de POSICIÓN (no de tamaño): si hay elementos
        // orbitales, se usa el semieje mayor de ESE planeta (así la
        // posición queda coherente con su propio aro de órbita). Si no hay
        // (Sol, o falló la consulta de elementos), se usa la distancia
        // instantánea del propio cuerpo.
        const distanciaRealKm = Math.sqrt(coords.x ** 2 + coords.y ** 2 + coords.z ** 2);
        let factor = 0;
        if (elementos) {
            factor = factorEscalaOrbita(elementos.semieje_mayor_km);
        } else if (distanciaRealKm > 0) {
            factor = escalarDistancia(distanciaRealKm) / distanciaRealKm;
        }

        // Mismo mapeo de ejes que usa el aro de órbita: X real -> x escena,
        // Z real -> y escena (altura), Y real -> z escena.
        const posicion = new THREE.Vector3(coords.x * factor, coords.z * factor, coords.y * factor);
        mesh.position.copy(posicion);
        scene.add(mesh);
        objetosCuerpos.push(mesh);

        if (esSol) {
            luzSol.position.copy(posicion);
        }

        // Marcador puntual: visible como un punto de tamaño fijo en pantalla
        // (no se achica con la distancia), para poder ubicar el cuerpo a
        // simple vista incluso cuando su radio real es sub-píxel.
        const marcadorPunto = new THREE.Points(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0)]),
            new THREE.PointsMaterial({ color: data.color, size: 5, sizeAttenuation: false })
        );
        marcadorPunto.position.copy(posicion);
        scene.add(marcadorPunto);
        objetosCuerpos.push(marcadorPunto);

        // Hitbox invisible: para la mayoría de los planetas, radio
        // CONSTANTE (basado en el radio exagerado, no en el radio visual
        // actual), para que el área clickeable no cambie al alternar el
        // modo de tamaño. El Sol es la excepción: al ser el único cuerpo
        // "central" junto al baricentro, su hitbox sigue de cerca su radio
        // visual actual (factor 1.5), igual que el baricentro.
        const radioClic = esSol
            ? calcularRadioAjustado(radioVisual, RADIO_MINIMO_CLIC)
            : calcularRadioHitbox(data);

        const hitbox = new THREE.Mesh(
            new THREE.SphereGeometry(radioClic, 16, 16),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        hitbox.position.copy(posicion);
        scene.add(hitbox);
        objetosCuerpos.push(hitbox);

        // Wireframe: para el Sol usa el mismo factor 1.5 ajustado al radio
        // visual actual (en vez del factor 1.3 genérico), para que quede
        // ceñido a su tamaño en pantalla igual que su hitbox.
        const radioWireframe = esSol
            ? calcularRadioAjustado(radioVisual, RADIO_MINIMO_WIREFRAME)
            : calcularRadioWireframe(radioVisual);
        const wireframe = new THREE.Mesh(
            new THREE.SphereGeometry(radioWireframe, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.9 })
        );
        wireframe.position.copy(posicion);
        wireframe.visible = false;
        scene.add(wireframe);
        objetosCuerpos.push(wireframe);

        cuerposInteractivos.push({ meshRaycast: hitbox, wireframe, nombre, datos: data });

        // Distancia visual máxima entre el semieje mayor (planetas) y la
        // posición instantánea (Sol), para poder encuadrar la cámara.
        const distanciaVisualCuerpo = elementos
            ? escalarDistancia(elementos.semieje_mayor_km)
            : escalarDistancia(distanciaRealKm);
        distanciaVisualMaxima = Math.max(distanciaVisualMaxima, distanciaVisualCuerpo);

        if (elementos) {
            const lineaOrbita = crearLineaOrbita(elementos, data.color);
            scene.add(lineaOrbita);
            objetosCuerpos.push(lineaOrbita);
        }
    });

    return distanciaVisualMaxima;
}

// Reencuadra la cámara para que el cuerpo más lejano quede visible, sin
// perder el ángulo de vista actual (mantiene la misma dirección, solo
// ajusta la distancia).
function encuadrarCamara(distanciaVisualMaxima) {
    if (!(distanciaVisualMaxima > 0)) return;

    const direccion = camera.position.clone().sub(controls.target);
    if (direccion.lengthSq() === 0) {
        direccion.set(0, 0.55, 0.85);
    }
    direccion.normalize();

    const distanciaCamara = distanciaVisualMaxima * 1.6 + 5;
    camera.position.copy(controls.target).addScaledVector(direccion, distanciaCamara);
    controls.update();
}

// Fecha actualmente consultada: null = tiempo real ("ahora"), o 'YYYY-MM-DD'
// elegido por el usuario en el panel de configuración.
let fechaSeleccionada = null;

async function cargarSistemaSolar(fecha) {
    fechaSeleccionada = fecha || null;
    elCargando.style.display = 'flex';
    elBannerError.style.display = 'none';

    let respuestaJson;
    try {
        const url = fechaSeleccionada
            ? `/api/sistema-solar?fecha=${encodeURIComponent(fechaSeleccionada)}`
            : '/api/sistema-solar';
        const res = await fetch(url);
        if (!res.ok) {
            const detalle = await res.json().catch(() => null);
            throw new Error(detalle && detalle.detail ? detalle.detail : `El servidor respondió con status ${res.status}`);
        }
        respuestaJson = await res.json();
    } catch (error) {
        console.error("No se pudo contactar a /api/sistema-solar:", error);
        mostrarError(
            "No se pudo conectar con el backend (/api/sistema-solar).\n" +
            `Detalle: ${error.message}\n` +
            "Revisa que el servidor FastAPI (uvicorn) esté corriendo y que no haya errores en su consola."
        );
        elCargando.style.display = 'none';
        return;
    }

    const cuerpos = respuestaJson.cuerpos || {};
    const errores = respuestaJson.errores || {};
    const nombres = Object.keys(cuerpos);

    console.log(`Cuerpos recibidos (${nombres.length}):`, cuerpos);
    if (Object.keys(errores).length > 0) {
        console.warn("Cuerpos con error al consultar JPL Horizons:", errores);
    }

    if (nombres.length === 0) {
        mostrarError(
            "La API respondió, pero no trajo ningún cuerpo celeste (probablemente JPL Horizons " +
            "no está devolviendo datos legibles). Detalle por cuerpo:\n" +
            Object.entries(errores).map(([n, e]) => `• ${n}: ${e}`).join("\n") +
            "\n\nRevisa la consola del servidor uvicorn: ahora imprime el motivo exacto de cada fallo."
        );
    } else if (Object.keys(errores).length > 0) {
        mostrarError(
            `Se dibujaron ${nombres.length} de ${nombres.length + Object.keys(errores).length} cuerpos. Fallaron:\n` +
            Object.entries(errores).map(([n, e]) => `• ${n}: ${e}`).join("\n")
        );
    }

    ultimosCuerpos = cuerpos;
    // Sin esto, los cuerpos de la consulta anterior (otra fecha) quedaban
    // en la escena junto a los nuevos, en vez de reemplazarlos.
    limpiarCuerpos();
    // Si había una cámara enfocada en un cuerpo (click previo), volver a
    // encuadrar el sistema completo en vez de quedar centrado en una
    // posición que puede ya no existir con los nuevos datos.
    controls.target.set(0, 0, 0);
    const distanciaMaxima = construirCuerpos(cuerpos);
    encuadrarCamara(distanciaMaxima);

    elCargando.style.display = 'none';
}

// Vuelve a dibujar todo con el modoEscala actual, reusando los últimos datos
// recibidos de la API (no vuelve a golpear JPL Horizons).
function reconstruirConEscalaActual() {
    if (!ultimosCuerpos) return; // todavía no llegó la primera respuesta de la API
    limpiarCuerpos();
    // Mismo motivo que en cargarSistemaSolar: no queremos quedar enfocados
    // en la posición vieja de un cuerpo si estaba enfocado antes del cambio.
    controls.target.set(0, 0, 0);
    const distanciaMaxima = construirCuerpos(ultimosCuerpos);
    encuadrarCamara(distanciaMaxima);
}

// ============================================================
// 6. Panel de información del cuerpo clickeado
// ============================================================
const elPanelInfo = document.getElementById('panel-info');
const elInfoNombre = document.getElementById('info-nombre');
const elInfoSubtitulo = document.getElementById('info-subtitulo');
const elInfoContenido = document.getElementById('info-contenido');

function formatearKm(valorKm) {
    return `${valorKm.toLocaleString('es-CL', { maximumFractionDigits: 0 })} km`;
}

function formatearGrados(valorDeg) {
    return `${valorDeg.toLocaleString('es-CL', { maximumFractionDigits: 3 })}°`;
}

// Nombre de archivo (sin extensión) esperado en static/resources/ para cada
// cuerpo: minúsculas, sin tildes. "sol.svg", "jupiter.svg", etc. Reemplaza
// esos archivos por fotos reales (p. ej. de JPL/NASA, de dominio público)
// para tener imágenes reales en vez de las ilustraciones generadas.
function slugCuerpo(nombre) {
    if (nombre.startsWith('Baricentro')) return 'baricentro';
    return nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Si el archivo no existe (p. ej. todavía no se reemplazó), oculta la
// imagen en vez de mostrar el ícono roto del navegador.
function crearImagenCuerpo(nombre) {
    const slug = slugCuerpo(nombre);
    return `<img class="imagen-cuerpo" src="resources/${slug}.svg" alt="${nombre}" onerror="this.style.display='none'">`;
}

// Arma el HTML del panel para un cuerpo (Sol/planeta) o para el baricentro.
function construirContenidoInfo(nombre, datos) {
    if (!datos) {
        // Caso baricentro: no es un cuerpo físico, no tiene radio/órbita/coordenadas propias.
        return `
            ${crearImagenCuerpo(nombre)}
            <p>El baricentro es el centro de masa de todo el sistema solar: el punto
            (0, 0, 0) respecto al cual JPL Horizons entrega las coordenadas de todos
            los demás cuerpos (<code>CENTER='500@0'</code> en la consulta a la API).</p>
            <p>No es un objeto físico ni tiene tamaño ni órbita propia — por eso no
            aparece información adicional acá.</p>
        `;
    }

    const distanciaRealKm = Math.sqrt(datos.coordenadas.x ** 2 + datos.coordenadas.y ** 2 + datos.coordenadas.z ** 2);
    const elementos = datos.elementos_orbitales;
    const esSol = nombre === "Sol";

    let html = `
        ${crearImagenCuerpo(nombre)}
        <h3>Tamaño</h3>
        <table>
            <tr><td>Radio real</td><td>${formatearKm(datos.radio_km)}</td></tr>
        </table>
        <p class="nota" style="margin-top:6px; border-top:none; padding-top:0;">
            ${modoTamano === 'real'
                ? 'Mostrando el tamaño real, proporcional a la distancia. Por eso puede ser casi invisible.'
                : 'Mostrando el tamaño exagerado (elegido a mano en main.py), no el real.'}
        </p>

        <h3>Coordenadas</h3>
        <table>
            <tr><td>X</td><td>${formatearKm(datos.coordenadas.x)}</td></tr>
            <tr><td>Y</td><td>${formatearKm(datos.coordenadas.y)}</td></tr>
            <tr><td>Z</td><td>${formatearKm(datos.coordenadas.z)}</td></tr>
            <tr><td>Distancia al baricentro</td><td>${formatearKm(distanciaRealKm)}</td></tr>
        </table>
    `;

    if (elementos) {
        const semiejeUA = elementos.semieje_mayor_km / KM_POR_UA;
        html += `
            <h3>Elementos orbitales</h3>
            <table>
                <tr><td>Excentricidad</td><td>${elementos.excentricidad.toFixed(4)}</td></tr>
                <tr><td>Semieje mayor</td><td>${formatearKm(elementos.semieje_mayor_km)} (${semiejeUA.toFixed(3)} UA)</td></tr>
                <tr><td>Perihelio</td><td>${formatearKm(elementos.perihelio_km)}</td></tr>
                <tr><td>Inclinación</td><td>${formatearGrados(elementos.inclinacion_deg)}</td></tr>
                <tr><td>Nodo ascendente (Ω)</td><td>${formatearGrados(elementos.nodo_ascendente_deg)}</td></tr>
                <tr><td>Arg. del perihelio (ω)</td><td>${formatearGrados(elementos.arg_perihelio_deg)}</td></tr>
            </table>
        `;
    } else if (esSol) {
        html += `
            <h3>Elementos orbitales</h3>
            <p>El Sol no tiene "elementos orbitales" respecto al baricentro: orbitar
            el propio centro de masa del sistema no tiene sentido físico. Su leve
            desplazamiento respecto al baricentro (visible arriba) se debe solo a la
            atracción gravitacional de los planetas, sobre todo Júpiter.</p>
        `;
    } else {
        html += `
            <h3>Elementos orbitales</h3>
            <p>No se pudieron obtener en la última consulta a JPL Horizons (revisa el
            log del servidor uvicorn para ver el motivo exacto). Por eso este cuerpo
            no tiene aro de órbita dibujado.</p>
        `;
    }

    const descripcionFecha = fechaSeleccionada
        ? `para el ${fechaSeleccionada} (mediodía UTC) — no en tiempo real`
        : 'en tiempo real (instante actual)';
    const descripcionCache = fechaSeleccionada
        ? 'indefinidamente, ya que la posición en una fecha fija no cambia'
        : 'por 5 minutos, para no saturar la API';

    html += `
        <p class="nota">
            Estas coordenadas${elementos || esSol ? ' y elementos orbitales' : ''} se consultan
            al sistema de efemérides JPL Horizons de la NASA
            (<code>ssd.jpl.nasa.gov/api/horizons.api</code>), ${descripcionFecha}.
            El servidor los guarda en caché ${descripcionCache}, pero el dato en sí viene
            de un cálculo dinámico de la NASA, no de un valor fijo en el código.
        </p>
    `;

    return html;
}

function mostrarInfoCuerpo(nombre, datos) {
    elInfoNombre.textContent = nombre;
    elInfoSubtitulo.textContent = datos
        ? (nombre === "Sol" ? "Estrella del sistema" : "Planeta")
        : "Punto de referencia";
    elInfoContenido.innerHTML = construirContenidoInfo(nombre, datos);
    abrirPanel(elPanelInfo);
}

// ============================================================
// 7. Paneles laterales: configuración e información (mismo estilo,
//    uno abierto a la vez)
// ============================================================
const botonConfig = document.getElementById('config-boton');
const elPanelConfig = document.getElementById('config-panel');

function abrirPanel(panel) {
    [elPanelConfig, elPanelInfo].forEach(p => {
        p.style.display = (p === panel) ? 'flex' : 'none';
    });
}

function cerrarPaneles() {
    elPanelConfig.style.display = 'none';
    elPanelInfo.style.display = 'none';
}

botonConfig.addEventListener('click', () => {
    const yaAbierto = elPanelConfig.style.display === 'flex';
    yaAbierto ? cerrarPaneles() : abrirPanel(elPanelConfig);
});

document.getElementById('cerrar-config').addEventListener('click', cerrarPaneles);
document.getElementById('cerrar-info').addEventListener('click', cerrarPaneles);

document.querySelectorAll('input[name="escala"]').forEach(radio => {
    radio.addEventListener('change', (evento) => {
        modoEscala = evento.target.value;
        reconstruirConEscalaActual();
    });
});

document.querySelectorAll('input[name="tamano"]').forEach(radio => {
    radio.addEventListener('change', (evento) => {
        modoTamano = evento.target.value;
        reconstruirConEscalaActual();
    });
});

// Selector de fecha: cambiarlo dispara una nueva consulta al backend (no es
// solo un cambio de escala visual, son datos distintos).
const inputFecha = document.getElementById('input-fecha');
const botonFechaActual = document.getElementById('usar-fecha-actual');
const elFechaDescripcion = document.getElementById('fecha-descripcion');

inputFecha.addEventListener('change', () => {
    if (!inputFecha.value) return;
    elFechaDescripcion.textContent = `Mostrando posiciones para el ${inputFecha.value} (mediodía UTC).`;
    cargarSistemaSolar(inputFecha.value);
});

botonFechaActual.addEventListener('click', () => {
    inputFecha.value = '';
    elFechaDescripcion.textContent = 'Mostrando posiciones en tiempo real.';
    cargarSistemaSolar(null);
});

// ============================================================
// 8. Interacción sobre los cuerpos: hover (wireframe) y click (panel)
// ============================================================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Wireframe actualmente encendido (o null si no hay ninguno), para poder
// apagarlo apenas el mouse deja de estar sobre ese cuerpo.
let wireframeActivo = null;

function actualizarMouse(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function cuerpoBajoElMouse() {
    raycaster.setFromCamera(mouse, camera);
    const meshes = cuerposInteractivos.map(c => c.meshRaycast);
    const intersecciones = raycaster.intersectObjects(meshes);
    if (intersecciones.length === 0) return null;
    return cuerposInteractivos.find(c => c.meshRaycast === intersecciones[0].object) || null;
}

function onPointerMoveEscena(event) {
    actualizarMouse(event);
    const cuerpo = cuerpoBajoElMouse();

    if (wireframeActivo && (!cuerpo || cuerpo.wireframe !== wireframeActivo)) {
        wireframeActivo.visible = false;
        wireframeActivo = null;
    }
    if (cuerpo) {
        cuerpo.wireframe.visible = true;
        wireframeActivo = cuerpo.wireframe;
    }

    renderer.domElement.style.cursor = cuerpo ? 'pointer' : 'default';
}
renderer.domElement.addEventListener('pointermove', onPointerMoveEscena);

// Centra la cámara en el cuerpo clickeado: mueve el punto de órbita de
// OrbitControls a la posición del cuerpo y acerca la cámara manteniendo el
// ángulo de vista actual. La distancia de acercamiento se calcula a partir
// del radio del hitbox (constante, no cambia con el modo de tamaño), así
// que el "zoom" queda igual de cómodo sin importar si el tamaño mostrado es
// real o exagerado.
function centrarCamaraEnCuerpo(cuerpo) {
    const posicion = cuerpo.meshRaycast.position;
    const radioReferencia = cuerpo.meshRaycast.geometry.parameters.radius;

    const direccion = camera.position.clone().sub(controls.target);
    if (direccion.lengthSq() === 0) {
        direccion.set(0, 0.4, 0.9);
    }
    direccion.normalize();

    const distanciaCamara = Math.max(radioReferencia * 9, 1.2);
    controls.target.copy(posicion);
    camera.position.copy(posicion).addScaledVector(direccion, distanciaCamara);
    controls.update();
}

function onClickEscena(event) {
    actualizarMouse(event);
    const cuerpo = cuerpoBajoElMouse();
    if (cuerpo) {
        mostrarInfoCuerpo(cuerpo.nombre, cuerpo.datos);
        centrarCamaraEnCuerpo(cuerpo);
    }
}
renderer.domElement.addEventListener('click', onClickEscena);

// ============================================================
// 9. Inicializar llamada y bucle de render
// ============================================================
cargarSistemaSolar(null);

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

// Ajustar canvas al redimensionar ventana
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
