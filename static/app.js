// ============================================================
// 1. Configuración de la escena 3D
// ============================================================
const scene = new THREE.Scene();
// near arranca en 0.05 (el mismo valor por defecto que se usa para la vista
// del sistema completo, ver cargarSistemaSolar/reconstruirConEscalaActual);
// se ajusta dinámicamente y de forma más chica solo al enfocar un cuerpo
// específico (ver centrarCamaraEnCuerpo), para no arrastrar una relación
// far/near innecesariamente extrema el resto del tiempo.
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 45000);
// logarithmicDepthBuffer: true evita el "z-fighting" (objetos que
// desaparecen o parpadean al acercar la cámara) que aparece cuando la
// relación far/near de la cámara es muy grande — acá es de 45.000.000:1
// (near=0.001, para poder acercarse a cuerpos en escala real como la
// Tierra, ~0.0016 unidades; far=45000, para que las estrellas de fondo
// sigan siendo visibles). Sin esto, el buffer de profundidad estándar no
// tiene precisión suficiente para distinguir bien los objetos cercanos.
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });

renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
// Nunca dejar que la cámara se acerque más que el "near" plane (0.001): si
// lo cruza, lo que esté justo ahí se recorta y desaparece (distinto del
// z-fighting de arriba, pero con el mismo síntoma visible).
controls.minDistance = 0.01;
controls.target.set(0, 0, 0); // el baricentro (origen de las coordenadas) queda como centro de órbita de la cámara
camera.position.set(0, 55, 85);

// Luz: el Sol se dibuja con MeshBasicMaterial (autoiluminado, no necesita luz).
// Los planetas usan MeshStandardMaterial para que se vean con volumen (lado
// iluminado / lado oscuro), así que necesitan una fuente de luz real. Se
// agrega una luz puntual en el origen del Sol (se reposiciona más abajo,
// una vez que sabemos su posición real) y una luz ambiental MUY tenue —
// a propósito casi nula, para que el lado oscuro quede casi negro, como en
// una foto real del espacio (sin atmósfera no hay luz que rebote hacia el
// lado que no mira al Sol). Si quedara en 0 exacto, el lado oscuro sería
// negro absoluto y perdería toda forma; con un resto mínimo se alcanza a
// distinguir que sigue siendo una esfera.
const luzSol = new THREE.PointLight(0xffffff, 2.2, 0, 0.4);
luzSol.position.set(0, 0, 0);
scene.add(luzSol);
scene.add(new THREE.AmbientLight(0x1a1a1a, 0.06));

// Fondo estrellado simple, solo estético.
function crearEstrellas() {
    const cantidad = 1500;
    const posiciones = new Float32Array(cantidad * 3);
    for (let idx = 0; idx < cantidad; idx++) {
        const radio = 24000 + Math.random() * 16000; // 20x más lejos que antes (1200-2000 -> 24000-40000)
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

// Mostrar/ocultar los aros de órbita de todos los cuerpos (independiente de
// mostrar/ocultar el cuerpo en sí, ver el índice). Por defecto se muestran.
let mostrarOrbitas = true;

function escalarDistancia(distanciaKm) {
    if (modoEscala === 'real') {
        return distanciaKm / KM_POR_UNIDAD_REAL;
    }
    // Math.sign(...) preserva el signo de la entrada: el semieje mayor de
    // una órbita hiperbólica (sondas que escapan del sistema solar, ver
    // crearLineaOrbita) es NEGATIVO por convención. Sin esto, Math.sqrt()
    // de un valor negativo da NaN y rompería la posición/órbita de esas
    // sondas en este modo de escala.
    const signo = Math.sign(distanciaKm) || 1;
    const distanciaUA = Math.abs(distanciaKm) / KM_POR_UA;
    return signo * UNIDADES_POR_RAIZ_UA * Math.sqrt(distanciaUA);
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
// 2a-bis. Escala de LUNAS (órbita y tamaño juntos: real | exagerada)
// ============================================================
// Un solo modo controla tanto la distancia de la luna a su planeta como su
// tamaño — elegible desde el panel de configuración.
//
// "real": usa la MISMA regla que la escala planetaria real — dividir por
// KM_POR_UNIDAD_REAL — pero SIEMPRE, sin importar en qué esté modoEscala en
// ese momento (si se reutilizara escalarDistancia() tal cual, el modo
// "exagerada" de las lunas heredaría sin querer la compresión con raíz
// cuadrada de los planetas). Con esta escala la Luna queda a solo ~0.096
// unidades de la Tierra: virtualmente invisible sin acercar mucho la
// cámara, que es fiel a lo chica que es una órbita lunar comparada con las
// distancias entre planetas.
//
// "exagerada": el bug que reportaste. Antes esta escala usaba una constante
// fija en km, totalmente ajena al planeta que orbita — cuando la escala
// planetaria estaba en "exagerada" (planetas comprimidos y cercanos entre
// sí), esa distancia fija terminaba pareciendo enorme al lado de un Sol-
// Tierra ya achicado. La corrección: la distancia de la luna a su planeta
// ahora es un múltiplo del radio_exagerado DE ESE PLANETA (un valor fijo
// definido en main.py, que no cambia con modoTamano ni con modoEscala), así
// que el aro siempre se ve proporcional al planeta que orbita, sin importar
// qué combinación de escalas esté activa. Cuando un planeta tiene varias
// lunas (p. ej. las 4 galileanas de Júpiter), cada una se ubica un poco más
// lejos que la anterior según su orden real (más cercana a más lejana),
// para que no queden todas amontonadas en el mismo radio.
let modoEscalaLuna = 'real'; // 'real' | 'exagerada'

function escalarDistanciaLunaReal(distanciaKm) {
    return distanciaKm / KM_POR_UNIDAD_REAL;
}

function distanciaVisualLunaExagerada(radioExageradoPadre, rangoEntreHermanas) {
    return radioExageradoPadre * (2.4 + rangoEntreHermanas * 1.5);
}

// Para cada luna, su posición entre las lunas DEL MISMO planeta (0 = la más
// cercana en distancia real), usado solo por la escala "exagerada" para
// separarlas visualmente. `cuerpos` es el objeto completo tal como llega de
// la API (no solo las lunas), se recalcula una vez por cada construcción.
function calcularRangosLunas(cuerpos) {
    const porPadre = {};
    Object.keys(cuerpos).forEach(nombre => {
        const datos = cuerpos[nombre];
        if (!datos.cuerpo_padre) return;
        const distanciaReal = datos.elementos_orbitales
            ? datos.elementos_orbitales.semieje_mayor_km
            : Math.sqrt(datos.coordenadas.x ** 2 + datos.coordenadas.y ** 2 + datos.coordenadas.z ** 2);
        (porPadre[datos.cuerpo_padre] = porPadre[datos.cuerpo_padre] || []).push({ nombre, distanciaReal });
    });

    const rangos = {};
    Object.values(porPadre).forEach(lista => {
        lista.sort((a, b) => a.distanciaReal - b.distanciaReal);
        lista.forEach((item, indice) => { rangos[item.nombre] = indice; });
    });
    return rangos;
}

// Calcula el factor de escala de POSICIÓN correcto para un cuerpo: si es una
// luna, usa la escala de lunas (real o exagerada, relativa a su padre); si
// no, la escala planetaria normal (relativa al baricentro). "cuerpos" y
// "rangosLunas" solo se usan para lunas en modo exagerado (para leer el
// radio_exagerado del padre y el orden entre hermanas).
function obtenerFactorEscalaPosicion(nombre, datos, cuerpos, rangosLunas) {
    const esLuna = !!datos.cuerpo_padre;
    const elementos = datos.elementos_orbitales;
    const distanciaRealKm = Math.sqrt(
        datos.coordenadas.x ** 2 + datos.coordenadas.y ** 2 + datos.coordenadas.z ** 2
    );

    if (esLuna) {
        const semiejeOInstantanea = elementos ? elementos.semieje_mayor_km : distanciaRealKm;
        if (semiejeOInstantanea <= 0) return 0;

        if (modoEscalaLuna === 'real') {
            return escalarDistanciaLunaReal(semiejeOInstantanea) / semiejeOInstantanea;
        }
        const padre = cuerpos[datos.cuerpo_padre];
        const radioExageradoPadre = padre ? padre.radio_exagerado : 1;
        const rango = rangosLunas[nombre] ?? 0;
        const distanciaVisual = distanciaVisualLunaExagerada(radioExageradoPadre, rango);
        return distanciaVisual / semiejeOInstantanea;
    }
    if (elementos) return factorEscalaOrbita(elementos.semieje_mayor_km);
    return distanciaRealKm > 0 ? escalarDistancia(distanciaRealKm) / distanciaRealKm : 0;
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
//
// Las lunas usan su PROPIO modo (modoEscalaLuna, ver arriba) en vez de
// modoTamano, para que "Escala de lunas" controle tamaño y órbita juntos
// sin depender de qué esté eligiendo el usuario para los planetas.
let modoTamano = 'real'; // 'real' | 'exagerada'

function calcularRadioVisual(datos) {
    const modo = datos.cuerpo_padre ? modoEscalaLuna : modoTamano;
    if (modo === 'real') {
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

// Factor aplicado al radio visual actual para obtener el radio de la zona
// interactiva (hitbox) y del wireframe. En "exagerada" el radio visual ya
// es lo bastante grande como para que 1.3x alcance; en "real" el radio
// visual suele ser diminuto, así que se usa un factor mayor (2x) para que
// el aro se note proporcional al tamaño real del cuerpo en vez de colapsar
// siempre al mismo piso mínimo (que era lo que pasaba antes: en escala real
// casi todos los cuerpos quedaban con el mismo wireframe, sin importar su
// tamaño real relativo, salvo el Sol — que ya usaba esta misma idea con
// factor 1.5 como caso especial). Ahora todo cuerpo (Sol, planetas, lunas,
// satélites, baricentro) sigue esta misma regla.
function factorRadioInteractivo(esModoReal) {
    return esModoReal ? 2.0 : 1.3;
}

function calcularRadioHitbox(radioVisual, esModoReal) {
    return Math.max(radioVisual * factorRadioInteractivo(esModoReal), RADIO_MINIMO_CLIC);
}

function calcularRadioWireframe(radioVisual, esModoReal) {
    return Math.max(radioVisual * factorRadioInteractivo(esModoReal), RADIO_MINIMO_WIREFRAME);
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
// "factor" ya viene calculado por el llamador (obtenerFactorEscalaPosicion):
// así esta función sirve igual para un planeta (factor relativo al
// baricentro) que para una luna (factor relativo a su planeta padre) sin
// necesitar dos versiones. El resultado queda centrado en el origen local
// (0,0,0) — el llamador debe trasladarlo a la posición del cuerpo padre
// (ver construirCuerpos) para lunas; para planetas el padre es el
// baricentro, así que no hace falta trasladar nada.
function crearLineaOrbita(elementos, color, factor, distanciaActualKm, segmentos = 720) {
    const aKm = elementos.semieje_mayor_km;
    const e = elementos.excentricidad;

    // Excentricidad >= 1 = órbita hiperbólica (o parabólica): no es una
    // elipse cerrada, es una trayectoria de escape (típico de sondas que
    // dejan el sistema solar, como las Voyager). Dos problemas distintos
    // hay que resolver acá:
    //
    // 1) La ecuación polar r(ν) = a(1-e²)/(1+e·cosν) solo es válida donde
    //    el denominador es positivo — barriendo las 360° completas como si
    //    fuera una elipse, el denominador cruza por cero y la curva se
    //    "rompe" visualmente. El límite real son los ±ν de la asíntota,
    //    donde cos(ν) = -1/e.
    //
    // 2) El semieje mayor "a" de una hiperbólica es una propiedad
    //    geométrica LOCAL (cerca del perihelio) — no tiene relación directa
    //    con qué tan lejos haya viajado el objeto. Para una sonda como la
    //    Voyager 1, |a| es menor a 1 UA aunque la sonda esté a más de 160
    //    UA del Sol. Si el arco se dibuja con un ángulo fijo (p. ej. ±90°)
    //    en vez de tener esto en cuenta, el resultado es un arquito
    //    minúsculo pegado al Sol: técnicamente válido, pero invisible
    //    comparado con la posición real de la sonda. Por eso el arco se
    //    extiende hasta la distancia ACTUAL del cuerpo (con un margen),
    //    en vez de hasta un ángulo arbitrario.
    const esHiperbolica = e >= 1;
    let nuMin, nuMax;

    if (esHiperbolica) {
        const p = aKm * (1 - e * e); // semi-latus rectum: siempre positivo para e > 1
        const nuAsintota = Math.acos(-1 / e); // límite real del rango válido

        const objetivoKm = (distanciaActualKm && distanciaActualKm > 0)
            ? distanciaActualKm * 1.15 // un poco más allá de donde está ahora, para sugerir que la trayectoria sigue
            : Math.abs(aKm) * (e + 1); // respaldo si no hay distancia actual disponible

        let cosNuObjetivo = (p / objetivoKm - 1) / e;
        cosNuObjetivo = Math.max(-1, Math.min(1, cosNuObjetivo));

        nuMax = Math.min(Math.acos(cosNuObjetivo), nuAsintota * 0.995); // nunca tocar la asíntota exacta (r -> infinito)
        nuMin = -nuMax;
    } else {
        nuMin = 0;
        nuMax = 2 * Math.PI;
    }

    const puntos = [];
    for (let s = 0; s <= segmentos; s++) {
        const nu = nuMin + (s / segmentos) * (nuMax - nuMin);
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
// clickear pese a que el marcador visual ahora es bastante más chico. El
// baricentro no tiene un modo real/exagerada propio, así que siempre usa el
// factor "real" (2x) — no hay una versión "exagerada" de un punto de
// referencia matemático.
const hitboxBaricentro = new THREE.Mesh(
    new THREE.SphereGeometry(calcularRadioHitbox(RADIO_BARICENTRO, true), 16, 16),
    new THREE.MeshBasicMaterial({ visible: false })
);
hitboxBaricentro.position.set(0, 0, 0);
scene.add(hitboxBaricentro);

const wireframeBaricentro = new THREE.Mesh(
    new THREE.SphereGeometry(calcularRadioWireframe(RADIO_BARICENTRO, true), 16, 16),
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

// Nombre del último cuerpo enfocado (por click o desde el índice), o null
// si no hay ninguno. Se usa en reconstruirConEscalaActual() para que la
// cámara mantenga su posición RELATIVA a ese cuerpo al cambiar de escala o
// al mostrar/ocultar las órbitas, en vez de resetear la vista al sistema
// completo cada vez (ver centrarCamaraEnCuerpo, que la actualiza).
let nombreCuerpoEnfocado = null;

// El índice (menú izquierdo) se arma una sola vez, la primera vez que llegan
// datos: el catálogo de cuerpos (categoría, cuerpo padre) es fijo — lo que
// cambia con la fecha son las coordenadas, no qué cuerpos existen.
let indiceConstruido = false;

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

// Posición absoluta (en unidades de escena) de cada cuerpo ya construido en
// esta pasada, indexada por nombre. Se usa para ubicar lunas relativas a su
// planeta padre, y se recalcula en cada llamada a construirCuerpos — incluye
// SIEMPRE la posición de todo cuerpo con datos válidos, esté visible o no,
// para que una luna visible con su planeta oculto (categoría "Planetas"
// desactivada) igual se ubique donde correspondería su padre.
const posicionesPorNombre = new Map();

// ============================================================
// 4b. Texturas de superficie (Sol, planetas y lunas)
// ============================================================
// Busca static/textures/<slug>.jpg (mismo slug que las fotos del panel de
// información, pero en una carpeta aparte — son imágenes distintas: acá se
// necesita un mapa equirectangular para envolver la esfera, no una foto
// cualquiera). Si el archivo no existe, el cuerpo se queda con su color
// plano de siempre, sin ningún error visible.
//
// Las texturas se cachean en memoria (slug -> THREE.Texture) para no volver
// a pedirle la imagen al navegador cada vez que se reconstruye la escena
// (cambio de escala, fecha, etc.) — el mismo objeto Texture se puede
// reutilizar en materiales nuevos sin problema.
const cargadorTexturas = new THREE.TextureLoader();
const cacheTexturas = new Map();

// Solo estas categorías tienen textura (no tiene mucho sentido para
// satélites/sondas artificiales, que son metal, no una superficie con
// mapa; ni para el baricentro, que no es un cuerpo físico).
function tieneTextura(categoria) {
    return categoria === 'sol' || categoria === 'planeta' || categoria === 'luna';
}

// Aplica la textura a un material ya creado (Sol y planetas usan
// MeshBasicMaterial/MeshStandardMaterial respectivamente, ambos soportan
// ".map" igual). Si carga después de que este material ya no esté en
// pantalla (p. ej. el usuario cambió de escala mientras cargaba), asignarla
// igual no genera ningún problema — simplemente no se llega a ver.
function aplicarTexturaCuerpo(material, nombre) {
    const slug = slugCuerpo(nombre);

    const yaCacheada = cacheTexturas.get(slug);
    if (yaCacheada) {
        material.map = yaCacheada;
        material.color.set(0xffffff); // no teñir la textura con el color plano de respaldo
        material.needsUpdate = true;
        return;
    }

    cargadorTexturas.load(
        `textures/${slug}.jpg`,
        (textura) => {
            cacheTexturas.set(slug, textura);
            material.map = textura;
            material.color.set(0xffffff);
            material.needsUpdate = true;
        },
        undefined,
        () => { /* sin textura para este cuerpo todavía: se queda con el color plano */ }
    );
}

// Dibuja el Sol y los planetas a partir de los datos ya recibidos de la API,
// usando el modoEscala/modoTamano actuales y el estado de visibilidad del
// índice (ver sección 10). Se puede llamar varias veces (p. ej. al cambiar
// de escala) sin volver a consultar el backend.
function construirCuerpos(cuerpos) {
    let distanciaVisualMaxima = 0;
    posicionesPorNombre.clear();
    const rangosLunas = calcularRangosLunas(cuerpos);

    Object.keys(cuerpos).forEach(nombre => {
        const data = cuerpos[nombre];
        const coords = data.coordenadas;
        const elementos = data.elementos_orbitales; // null para el Sol (o si Horizons no los pudo leer)
        const esSol = nombre === "Sol";
        const esLuna = !!data.cuerpo_padre;

        // Posición del cuerpo padre (para lunas) o el origen (para todo lo
        // demás, que orbita el baricentro). Si es una luna cuyo padre no
        // tiene posición conocida (falló en la API, o es un padre que no
        // existe en el catálogo), no se puede ubicar: se omite por completo.
        let posicionPadre = new THREE.Vector3(0, 0, 0);
        if (esLuna) {
            if (!posicionesPorNombre.has(data.cuerpo_padre)) {
                console.warn(`"${nombre}" no se pudo ubicar: su cuerpo padre "${data.cuerpo_padre}" no está disponible.`);
                return;
            }
            posicionPadre = posicionesPorNombre.get(data.cuerpo_padre);
        }

        const factor = obtenerFactorEscalaPosicion(nombre, data, cuerpos, rangosLunas);
        const posicionLocal = new THREE.Vector3(coords.x * factor, coords.z * factor, coords.y * factor);
        const posicion = posicionPadre.clone().add(posicionLocal);
        posicionesPorNombre.set(nombre, posicion);

        // La distancia usada para encuadrar la cámara por defecto SOLO
        // considera al Sol y los planetas: las lunas ya quedan encuadradas
        // junto con su planeta (su aporte es minúsculo en comparación), y
        // los satélites/sondas heliocéntricos (p. ej. las Voyager, a cientos
        // de UA) arruinarían el encuadre por defecto si se incluyeran acá.
        // Sí se puede llegar a ellos clickeándolos desde el índice, que
        // centra la cámara individualmente (ver centrarCamaraEnCuerpo).
        if (data.categoria === 'sol' || data.categoria === 'planeta') {
            const distanciaVisualCuerpo = elementos
                ? escalarDistancia(elementos.semieje_mayor_km)
                : escalarDistancia(Math.sqrt(coords.x ** 2 + coords.y ** 2 + coords.z ** 2));
            distanciaVisualMaxima = Math.max(distanciaVisualMaxima, distanciaVisualCuerpo);
        }

        // Si el usuario ocultó este cuerpo (individualmente o toda su
        // categoría) desde el índice, no se dibuja nada — pero su posición
        // ya quedó guardada arriba, para que sus propias lunas (si las
        // tuviera) igual se ubiquen correctamente.
        if (!esCuerpoVisible(nombre)) return;

        const radioVisual = calcularRadioVisual(data);

        // Mesh visual: lo que realmente se ve. En escala de tamaño real
        // puede terminar siendo sub-píxel (p. ej. la Tierra), y eso es
        // intencional: así de chicos son los planetas comparados con las
        // distancias reales entre ellos.
        const geo = new THREE.SphereGeometry(radioVisual, 32, 32);
        const mat = esSol
            ? new THREE.MeshBasicMaterial({ color: data.color })
            : new THREE.MeshStandardMaterial({ color: data.color, roughness: 0.9, metalness: 0 });
        if (tieneTextura(data.categoria)) {
            aplicarTexturaCuerpo(mat, nombre);
        }
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(posicion);
        scene.add(mesh);
        objetosCuerpos.push(mesh);

        if (esSol) {
            luzSol.position.copy(posicion);
        }

        // Anillos de Saturno: un plano con forma de anillo (RingGeometry),
        // "acostado" (rotado 90° en X) para que quede horizontal en vez de
        // vertical, con el mismo mapeo de ejes que el resto de la escena
        // (Y = arriba). El radio interior/exterior es proporcional al radio
        // visual ACTUAL de Saturno (se recalcula si cambia el modo de
        // tamaño), usando aproximadamente la proporción real de sus
        // anillos principales (de ~1.2x a ~2.3x el radio del planeta).
        if (nombre === "Saturno") {
            const radioInteriorAnillo = radioVisual * 1.2;
            const radioExteriorAnillo = radioVisual * 2.3;
            const geoAnillo = new THREE.RingGeometry(radioInteriorAnillo, radioExteriorAnillo, 64);
            const matAnillo = new THREE.MeshBasicMaterial({
                color: data.color,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.55,
            });
            const anillo = new THREE.Mesh(geoAnillo, matAnillo);
            anillo.rotation.x = -Math.PI / 2;
            anillo.position.copy(posicion);
            scene.add(anillo);
            objetosCuerpos.push(anillo);
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

        // Hitbox invisible y wireframe: qué tan lejos quedan de la
        // superficie real del cuerpo depende de la categoría.
        //
        // - Sol y planetas: SIN piso mínimo — se ciñen directamente a un
        //   múltiplo de su propio radio visual actual (factor 2x en modo
        //   "real", 1.3x en "exagerada"), igual que ya hacía el Sol. En
        //   escala real esto los deja muy chicos para clickear con
        //   precisión con el mouse (el radio real de Júpiter, el más
        //   grande, es de apenas 0.0175 unidades) — para eso está el
        //   índice (menú izquierdo), que no depende de acertarle con el
        //   mouse.
        //
        // - Lunas y misiones/satélites artificiales: mismo criterio, pero
        //   con 2/3 del factor que usan los planetas (más ceñidas a su
        //   propia superficie). Antes los satélites tenían un piso mínimo
        //   grande aparte (para compensar que su radio real es
        //   virtualmente cero, son objetos de metros) que terminaba
        //   dejando su zona de mouse notoriamente más grande que la de una
        //   luna — ahora usan exactamente la misma fórmula que las lunas,
        //   sin ese piso aparte.
        const esModoReal = esLuna ? (modoEscalaLuna === 'real') : (modoTamano === 'real');
        const esLunaOSatelite = esLuna || data.categoria === 'satelite';

        const factorCuerpo = factorRadioInteractivo(esModoReal) * (esLunaOSatelite ? (2 / 3) : 1);
        // Piso técnico minúsculo, solo para evitar geometría de radio 0
        // (no busca garantizar que sea clickeable — ver comentario arriba).
        const radioMinimoTecnico = 0.0005;
        const radioClic = Math.max(radioVisual * factorCuerpo, radioMinimoTecnico);
        const radioWireframe = Math.max(radioVisual * factorCuerpo, radioMinimoTecnico);

        const hitbox = new THREE.Mesh(
            new THREE.SphereGeometry(radioClic, 16, 16),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        hitbox.position.copy(posicion);
        scene.add(hitbox);
        objetosCuerpos.push(hitbox);

        const wireframe = new THREE.Mesh(
            new THREE.SphereGeometry(radioWireframe, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.9 })
        );
        wireframe.position.copy(posicion);
        wireframe.visible = false;
        scene.add(wireframe);
        objetosCuerpos.push(wireframe);

        cuerposInteractivos.push({ meshRaycast: hitbox, wireframe, nombre, datos: data });

        if (elementos && mostrarOrbitas) {
            const distanciaActualKm = Math.sqrt(coords.x ** 2 + coords.y ** 2 + coords.z ** 2);
            // segmentos: usa el valor por defecto (720) para todos los
            // cuerpos por igual — una sola medida común, sin variar según
            // la categoría (los satélites/sondas no reciben un valor
            // distinto ni más bajo).
            const lineaOrbita = crearLineaOrbita(elementos, data.color, factor, distanciaActualKm);
            // El aro se genera centrado en el origen local; se traslada al
            // padre acá (baricentro para planetas/Sol/satélites — sin
            // efecto, ya que posicionPadre es (0,0,0) — o el planeta padre
            // para lunas).
            lineaOrbita.position.copy(posicionPadre);
            scene.add(lineaOrbita);
            objetosCuerpos.push(lineaOrbita);
        }
    });

    return distanciaVisualMaxima;
}

// Reencuadra la cámara para que el cuerpo más lejano quede visible, sin
// perder el ángulo de vista actual (mantiene la misma dirección, solo
// ajusta la distancia).
// Recuerda la última distancia "de encuadre completo" aplicada (ya con el
// ×1.6 + 5 de la fórmula de acá abajo), para poder calcular cuánto se
// acercó/alejó el usuario en términos RELATIVOS y aplicar ese mismo nivel
// de zoom después de reconstruir la escena (cambio de escala, fecha,
// mostrar/ocultar órbitas, etc.) — sin esto, cualquier reconstrucción
// volvía siempre a la distancia por defecto, "reseteando" el zoom manual
// del usuario. Se invalida (null) en centrarCamaraEnCuerpo, porque ahí la
// cámara pasa a relacionarse con la distancia a un cuerpo puntual, no con
// el encuadre del sistema completo.
let ultimaDistanciaEncuadre = null;

function encuadrarCamara(distanciaVisualMaxima) {
    if (!(distanciaVisualMaxima > 0)) return;

    const direccion = camera.position.clone().sub(controls.target);
    if (direccion.lengthSq() === 0) {
        direccion.set(0, 0.55, 0.85);
    }
    direccion.normalize();

    const distanciaBase = distanciaVisualMaxima * 1.6 + 5;
    let distanciaCamara = distanciaBase;

    if (ultimaDistanciaEncuadre) {
        const distanciaActual = camera.position.distanceTo(controls.target);
        const factorZoom = distanciaActual / ultimaDistanciaEncuadre;
        distanciaCamara = distanciaBase * factorZoom;
    }

    camera.position.copy(controls.target).addScaledVector(direccion, distanciaCamara);
    controls.update();

    ultimaDistanciaEncuadre = distanciaBase;
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

    // Al elegir una fecha específica (no "ahora"), es ESPERABLE que una
    // sonda no tenga datos si la fecha es anterior a su lanzamiento — no es
    // un error real, así que no se muestra en el banner (sigue quedando en
    // la consola del navegador para quien quiera revisarlo). En modo
    // "ahora" si se muestran, porque ahí sí sería una falla genuina.
    const erroresAMostrar = fechaSeleccionada
        ? Object.fromEntries(Object.entries(errores).filter(([, e]) => e.categoria !== 'satelite'))
        : errores;
    const totalErroresAMostrar = Object.keys(erroresAMostrar).length;

    if (nombres.length === 0 && totalErroresAMostrar > 0) {
        mostrarError(
            "La API respondió, pero no trajo ningún cuerpo celeste (probablemente JPL Horizons " +
            "no está devolviendo datos legibles). Detalle por cuerpo:\n" +
            Object.entries(erroresAMostrar).map(([n, e]) => `• ${n}: ${e.mensaje}`).join("\n") +
            "\n\nRevisa la consola del servidor uvicorn: ahora imprime el motivo exacto de cada fallo."
        );
    } else if (totalErroresAMostrar > 0) {
        mostrarError(
            `Se dibujaron ${nombres.length} de ${nombres.length + totalErroresAMostrar} cuerpos. Fallaron:\n` +
            Object.entries(erroresAMostrar).map(([n, e]) => `• ${n}: ${e.mensaje}`).join("\n")
        );
    }

    ultimosCuerpos = cuerpos;
    if (!indiceConstruido && nombres.length > 0) {
        construirIndice(cuerpos);
        indiceConstruido = true;
    }
    // Sin esto, los cuerpos de la consulta anterior (otra fecha) quedaban
    // en la escena junto a los nuevos, en vez de reemplazarlos.
    limpiarCuerpos();
    // Si había una cámara enfocada en un cuerpo (click previo), volver a
    // encuadrar el sistema completo en vez de quedar centrado en una
    // posición que puede ya no existir con los nuevos datos.
    controls.target.set(0, 0, 0);
    // El near plane vuelve a un valor por defecto razonable (no el mínimo
    // extremo que se usa al enfocar cuerpos diminutos en escala real — ver
    // centrarCamaraEnCuerpo) para no arrastrar una relación far/near
    // innecesariamente extrema a la vista general del sistema.
    camera.near = 0.05;
    camera.updateProjectionMatrix();
    const distanciaMaxima = construirCuerpos(cuerpos);
    encuadrarCamara(distanciaMaxima);

    elCargando.style.display = 'none';
}

// Vuelve a dibujar todo con el modoEscala actual, reusando los últimos datos
// recibidos de la API (no vuelve a golpear JPL Horizons).
function reconstruirConEscalaActual() {
    if (!ultimosCuerpos) return; // todavía no llegó la primera respuesta de la API
    limpiarCuerpos();
    const distanciaMaxima = construirCuerpos(ultimosCuerpos);

    // Si había un cuerpo enfocado (click previo, o desde el índice), se
    // vuelve a enfocar después de reconstruir — centrarCamaraEnCuerpo ya
    // preserva el ángulo de vista actual, así que la cámara mantiene su
    // posición relativa al cuerpo en vez de saltar a la vista del sistema
    // completo. Si ese cuerpo ya no existe en la reconstrucción (p. ej. se
    // ocultó desde el índice), se cae de vuelta al encuadre general.
    const cuerpoAReenfocar = nombreCuerpoEnfocado
        ? cuerposInteractivos.find(c => c.nombre === nombreCuerpoEnfocado)
        : null;

    if (cuerpoAReenfocar) {
        centrarCamaraEnCuerpo(cuerpoAReenfocar, true);
    } else {
        controls.target.set(0, 0, 0);
        // Mismo motivo que en cargarSistemaSolar: volver a un near plane
        // razonable para la vista general, en vez de arrastrar el valor
        // extremo que pudo haber quedado de un enfoque anterior.
        camera.near = 0.05;
        camera.updateProjectionMatrix();
        encuadrarCamara(distanciaMaxima);
    }
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
// cuerpo: minúsculas, sin tildes, sin paréntesis, espacios reemplazados por
// guiones. "sol.jpg", "jupiter.jpg", "voyager-1.jpg", "james-webb-jwst.jpg".
// Reemplaza esos archivos por fotos reales (p. ej. de JPL/NASA, de dominio
// público) para tener imágenes reales en vez de las ilustraciones generadas.
function slugCuerpo(nombre) {
    if (nombre.startsWith('Baricentro')) return 'baricentro';
    return nombre
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[()]/g, '')
        .replace(/\s+/g, '-');
}

// Si el archivo no existe (p. ej. todavía no se reemplazó), oculta la
// imagen en vez de mostrar el ícono roto del navegador.
function crearImagenCuerpo(nombre) {
    const slug = slugCuerpo(nombre);
    return `<img class="imagen-cuerpo" src="resources/${slug}.jpg" alt="${nombre}" onerror="this.style.display='none'">`;
}

// Contenedor para el texto de static/resources/<slug>.txt, debajo de la
// imagen. Se llena de forma asíncrona (ver cargarDescripcionCuerpo) porque
// a diferencia de la imagen (que el navegador carga solo), un archivo de
// texto hay que pedirlo con fetch() y esperar la respuesta. data-nombre
// sirve para descartar la respuesta si el usuario ya abrió otro cuerpo
// antes de que termine de cargar.
function crearContenedorDescripcion(nombre) {
    return `<p class="descripcion-cuerpo" id="descripcion-cuerpo-actual" data-nombre="${nombre}">Cargando información…</p>`;
}

// Pide static/resources/<slug>.txt y lo muestra en el contenedor de arriba.
// Si el archivo no existe (todavía no se escribió uno para ese cuerpo), el
// contenedor se saca del todo — igual que la imagen, no hay una sección
// "vacía" visible, simplemente no aparece.
async function cargarDescripcionCuerpo(nombre) {
    const slug = slugCuerpo(nombre);
    let texto = null;
    try {
        const res = await fetch(`resources/${slug}.txt`);
        if (res.ok) texto = (await res.text()).trim();
    } catch (error) {
        texto = null;
    }

    // El panel pudo haberse cerrado, o el usuario pudo haber abierto otro
    // cuerpo mientras esta solicitud estaba en camino — en ese caso el
    // contenedor de acá ya no es el vigente (o ya no existe) y no hay que
    // tocar nada.
    const contenedor = document.getElementById('descripcion-cuerpo-actual');
    if (!contenedor || contenedor.dataset.nombre !== nombre) return;

    if (texto) {
        contenedor.textContent = texto;
    } else {
        contenedor.remove();
    }
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
        ${crearContenedorDescripcion(nombre)}
        <h3>Tamaño</h3>
        <table>
            <tr><td>Radio real</td><td>${formatearKm(datos.radio_km)}</td></tr>
        </table>
        <p class="nota" style="margin-top:6px; border-top:none; padding-top:0;">
            ${modoTamano === 'real'
                ? '(Mostrando el tamaño real)'
                : '(Mostrando el tamaño exagerado, no real)'}
        </p>

        <h3>Coordenadas (relativas a ${datos.cuerpo_padre || 'el baricentro'})</h3>
        <table>
            <tr><td>X</td><td>${formatearKm(datos.coordenadas.x)}</td></tr>
            <tr><td>Y</td><td>${formatearKm(datos.coordenadas.y)}</td></tr>
            <tr><td>Z</td><td>${formatearKm(datos.coordenadas.z)}</td></tr>
            <tr><td>Distancia a ${datos.cuerpo_padre || 'el baricentro'}</td><td>${formatearKm(distanciaRealKm)}</td></tr>
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
            <p>El Sol no tiene "elementos orbitales" respecto al baricentro.</p>
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
            (<code>ssd.jpl.nasa.gov/api/horizons.api</code>).
        </p>
    `;

    return html;
}

function mostrarInfoCuerpo(nombre, datos) {
    elInfoNombre.textContent = nombre;
    elInfoSubtitulo.textContent = subtituloCuerpo(datos);
    elInfoContenido.innerHTML = construirContenidoInfo(nombre, datos);
    abrirPanel(elPanelInfo);

    if (datos) {
        cargarDescripcionCuerpo(nombre);
    }
}

function subtituloCuerpo(datos) {
    if (!datos) return "Punto de referencia";
    switch (datos.categoria) {
        case 'sol': return "Estrella del sistema";
        case 'planeta': return "Planeta";
        case 'luna': return `Luna de ${datos.cuerpo_padre}`;
        case 'satelite': return "Satélite artificial / sonda";
        default: return "Cuerpo celeste";
    }
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

document.querySelectorAll('input[name="escala-luna"]').forEach(radio => {
    radio.addEventListener('change', (evento) => {
        modoEscalaLuna = evento.target.value;
        reconstruirConEscalaActual();
    });
});

document.getElementById('input-mostrar-orbitas').addEventListener('change', (evento) => {
    mostrarOrbitas = evento.target.checked;
    reconstruirConEscalaActual();
});

// Selector de fecha: a propósito NO se dispara con el evento "change" del
// input nativo — al escribir la fecha a mano (en vez de usar el calendario
// desplegable), "change" puede disparar con cada segmento que se completa
// (día, mes, año), incluso antes de que el usuario termine de escribir el
// año completo, mandando fechas a medio terminar al backend y generando
// errores. En cambio, la consulta se dispara solo con una confirmación
// explícita: el botón "Ir", o Enter con el foco en el campo.
const inputFecha = document.getElementById('input-fecha');
const botonConfirmarFecha = document.getElementById('confirmar-fecha');
const botonFechaActual = document.getElementById('usar-fecha-actual');
const elFechaDescripcion = document.getElementById('fecha-descripcion');

function confirmarFechaElegida() {
    if (!inputFecha.value) return; // campo vacío o fecha todavía incompleta: no hacer nada
    elFechaDescripcion.textContent = `Mostrando posiciones para el ${inputFecha.value} (mediodía UTC).`;
    cargarSistemaSolar(inputFecha.value);
}

botonConfirmarFecha.addEventListener('click', confirmarFechaElegida);

inputFecha.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') {
        evento.preventDefault();
        confirmarFechaElegida();
    }
});

botonFechaActual.addEventListener('click', () => {
    inputFecha.value = '';
    elFechaDescripcion.textContent = 'Mostrando posiciones en tiempo real.';
    cargarSistemaSolar(null);
});

// ============================================================
// 8. Índice de cuerpos (menú izquierdo): mostrar/ocultar por cuerpo o por
//    categoría completa, y seleccionar un cuerpo igual que clickeándolo
// ============================================================
// Visibilidad por nombre de cuerpo. Sin entrada = visible (default). Se
// preserva entre cambios de escala/fecha (no se resetea en construirCuerpos
// ni en cargarSistemaSolar), para que ocultar algo se mantenga al navegar.
const visibilidadCuerpos = {};

function esCuerpoVisible(nombre) {
    return visibilidadCuerpos[nombre] !== false;
}

// nombre -> <input type="checkbox"> de ese cuerpo en el índice, y
// categoría-de-índice -> lista de nombres que agrupa esa casilla maestra
// (el Sol se agrupa bajo la casilla maestra "planeta"). Se completan al
// construir el índice y se usan para mantener sincronizadas las casillas
// maestras con el estado real de sus miembros.
const casillasIndicePorNombre = {};
const nombresPorCategoriaIndice = {};

function grupoIndiceDeCategoria(categoria) {
    return categoria === 'sol' ? 'planeta' : categoria;
}

// Sincroniza la casilla maestra de una categoría con el estado de sus
// miembros: marcada si todos están visibles, vacía si ninguno, e
// "indeterminate" (barra en vez de tilde) si es una mezcla.
function actualizarCasillaCategoria(categoriaBody) {
    const grupo = grupoIndiceDeCategoria(categoriaBody);
    const nombres = nombresPorCategoriaIndice[grupo];
    const casillaCat = document.querySelector(`#indice-contenido input[data-categoria="${grupo}"]`);
    if (!nombres || !casillaCat) return;

    const visibles = nombres.filter(esCuerpoVisible).length;
    casillaCat.checked = visibles === nombres.length;
    casillaCat.indeterminate = visibles > 0 && visibles < nombres.length;
}

function crearItemIndice(nombre, datos) {
    const li = document.createElement('li');

    const casilla = document.createElement('input');
    casilla.type = 'checkbox';
    casilla.checked = esCuerpoVisible(nombre);
    casilla.addEventListener('change', () => {
        visibilidadCuerpos[nombre] = casilla.checked;
        actualizarCasillaCategoria(datos.categoria);
        reconstruirConEscalaActual();
    });
    casillasIndicePorNombre[nombre] = casilla;

    const muestra = document.createElement('span');
    muestra.className = 'muestra-color';
    muestra.style.backgroundColor = datos.color;

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'indice-cuerpo-nombre';
    boton.textContent = nombre;
    boton.addEventListener('click', () => seleccionarDesdeIndice(nombre));

    li.appendChild(casilla);
    li.appendChild(muestra);
    li.appendChild(boton);
    return li;
}

// Arma el índice completo (una sola vez, la primera vez que llegan datos):
// Planetas (incluido el Sol) / Lunas (agrupadas por su planeta padre) /
// Satélites artificiales. Cada categoría con su propia casilla maestra.
// Distancia real (en km) de un cuerpo al Sol/baricentro, usando sus propias
// coordenadas. Solo tiene sentido para cuerpos que orbitan el baricentro
// (Sol, planetas, satélites) — las coordenadas de una luna son relativas a
// su planeta padre, no al Sol, así que esta función NO sirve para ordenar
// lunas directamente (ver más abajo cómo se usa ahí).
function distanciaHeliocentricaKm(datos) {
    return Math.sqrt(datos.coordenadas.x ** 2 + datos.coordenadas.y ** 2 + datos.coordenadas.z ** 2);
}

function construirIndice(cuerpos) {
    const contenedor = document.getElementById('indice-contenido');
    contenedor.innerHTML = '';

    const grupos = [
        { clave: 'planeta', titulo: 'Planetas', incluirSol: true, agruparPorPadre: false },
        { clave: 'luna', titulo: 'Lunas', incluirSol: false, agruparPorPadre: true },
        { clave: 'satelite', titulo: 'Satélites artificiales', incluirSol: false, agruparPorPadre: false },
    ];

    grupos.forEach(grupo => {
        const nombresGrupo = Object.keys(cuerpos).filter(n => {
            const c = cuerpos[n].categoria;
            return c === grupo.clave || (grupo.incluirSol && c === 'sol');
        });
        if (nombresGrupo.length === 0) return;

        // Orden por cercanía real al Sol (distancia actual, no promedio —
        // por eso Plutón puede aparecer antes que Neptuno si ese día está
        // en la parte de su órbita más cercana al Sol que Neptuno, algo
        // que de hecho pasa periódicamente). No afecta a las lunas acá
        // (esas se ordenan aparte, ver más abajo), porque sus coordenadas
        // son relativas a su planeta, no al Sol.
        if (!grupo.agruparPorPadre) {
            nombresGrupo.sort((a, b) => distanciaHeliocentricaKm(cuerpos[a]) - distanciaHeliocentricaKm(cuerpos[b]));
        }

        nombresPorCategoriaIndice[grupo.clave] = nombresGrupo;

        const bloque = document.createElement('div');
        bloque.className = 'indice-categoria';

        const headerLabel = document.createElement('label');
        headerLabel.className = 'indice-categoria-header';
        const casillaCat = document.createElement('input');
        casillaCat.type = 'checkbox';
        casillaCat.checked = true;
        casillaCat.dataset.categoria = grupo.clave;
        const tituloEl = document.createElement('strong');
        tituloEl.textContent = grupo.titulo;
        headerLabel.appendChild(casillaCat);
        headerLabel.appendChild(tituloEl);
        bloque.appendChild(headerLabel);

        casillaCat.addEventListener('change', () => {
            nombresGrupo.forEach(n => {
                visibilidadCuerpos[n] = casillaCat.checked;
                if (casillasIndicePorNombre[n]) casillasIndicePorNombre[n].checked = casillaCat.checked;
            });
            reconstruirConEscalaActual();
        });

        const lista = document.createElement('ul');
        lista.className = 'indice-lista';

        if (grupo.agruparPorPadre) {
            const padresVistos = [];
            const porPadre = {};
            nombresGrupo.forEach(n => {
                const padre = cuerpos[n].cuerpo_padre || 'Sin padre conocido';
                if (!porPadre[padre]) { porPadre[padre] = []; padresVistos.push(padre); }
                porPadre[padre].push(n);
            });

            // Grupos (por planeta padre) ordenados por la cercanía real de
            // ESE planeta al Sol; dentro de cada grupo, las lunas ordenadas
            // por su propia cercanía a su planeta (sus coordenadas ya son
            // relativas a él, así que acá distanciaHeliocentricaKm sí sirve
            // directamente pese al nombre).
            padresVistos.sort((a, b) => {
                const distA = cuerpos[a] ? distanciaHeliocentricaKm(cuerpos[a]) : Infinity;
                const distB = cuerpos[b] ? distanciaHeliocentricaKm(cuerpos[b]) : Infinity;
                return distA - distB;
            });
            padresVistos.forEach(padre => {
                porPadre[padre].sort((a, b) => distanciaHeliocentricaKm(cuerpos[a]) - distanciaHeliocentricaKm(cuerpos[b]));

                const subtitulo = document.createElement('li');
                subtitulo.className = 'indice-subgrupo-titulo';
                subtitulo.textContent = padre;
                lista.appendChild(subtitulo);
                porPadre[padre].forEach(n => lista.appendChild(crearItemIndice(n, cuerpos[n])));
            });
        } else {
            nombresGrupo.forEach(n => lista.appendChild(crearItemIndice(n, cuerpos[n])));
        }

        bloque.appendChild(lista);
        contenedor.appendChild(bloque);
    });
}

// Seleccionar un cuerpo desde el índice hace lo mismo que clickearlo en la
// escena 3D. Si estaba oculto, primero se muestra (auto-activa su casilla y
// la de su categoría) para que tenga sentido enfocar la cámara en él.
function seleccionarDesdeIndice(nombre) {
    if (!ultimosCuerpos || !ultimosCuerpos[nombre]) return;

    if (!esCuerpoVisible(nombre)) {
        visibilidadCuerpos[nombre] = true;
        if (casillasIndicePorNombre[nombre]) casillasIndicePorNombre[nombre].checked = true;
        actualizarCasillaCategoria(ultimosCuerpos[nombre].categoria);
        reconstruirConEscalaActual();
    }

    const cuerpo = cuerposInteractivos.find(c => c.nombre === nombre);
    if (cuerpo) {
        mostrarInfoCuerpo(cuerpo.nombre, cuerpo.datos);
        // true: si es el mismo cuerpo que ya estaba enfocado, preserva el
        // zoom manual en vez de resetear a la distancia por defecto (si es
        // un cuerpo distinto, esto no tiene efecto — centrarCamaraEnCuerpo
        // ya distingue ambos casos por nombre).
        centrarCamaraEnCuerpo(cuerpo, true);
    }
}

// El índice es un panel independiente (a la izquierda) de config/info (a la
// derecha): no participa del "un panel abierto a la vez" de abrirPanel().
const botonIndice = document.getElementById('indice-boton');
const elPanelIndice = document.getElementById('indice-panel');

botonIndice.addEventListener('click', () => {
    elPanelIndice.style.display = (elPanelIndice.style.display === 'flex') ? 'none' : 'flex';
});
document.getElementById('cerrar-indice').addEventListener('click', () => {
    elPanelIndice.style.display = 'none';
});

// Mostrar/ocultar toda la interfaz superpuesta (título, ayuda, botones,
// paneles) de una sola vez, dejando solo la escena 3D visible — útil para
// capturas de pantalla o simplemente para ver el sistema solar sin nada
// encima. El botón que lo controla vive FUERA de #capa-ui a propósito (ver
// el comentario en index.html), así que nunca se oculta a sí mismo.
const botonUiToggle = document.getElementById('ui-toggle-boton');
const capaUi = document.getElementById('capa-ui');
let interfazVisible = true;

botonUiToggle.addEventListener('click', () => {
    interfazVisible = !interfazVisible;
    capaUi.style.display = interfazVisible ? '' : 'none';
    botonUiToggle.title = interfazVisible ? 'Ocultar interfaz' : 'Mostrar interfaz';
});

// ============================================================
// 10. Interacción sobre los cuerpos: hover (wireframe) y click (panel)
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

    // El wireframe deseado es null si no hay cuerpo bajo el mouse, o si ese
    // cuerpo es el que ya está seleccionado/enfocado (no se le muestra el
    // wireframe, aunque sigue siendo clickeable). Comparar contra el
    // "deseado" en vez de solo contra "hubo cambio de cuerpo" evita que el
    // wireframe quede encendido de un hover previo si, sin mover el mouse,
    // ese mismo cuerpo pasa a estar seleccionado (p. ej. justo al clickearlo).
    const wireframeDeseado = (cuerpo && cuerpo.nombre !== nombreCuerpoEnfocado) ? cuerpo.wireframe : null;

    if (wireframeActivo && wireframeActivo !== wireframeDeseado) {
        wireframeActivo.visible = false;
    }
    if (wireframeDeseado) {
        wireframeDeseado.visible = true;
    }
    wireframeActivo = wireframeDeseado;

    renderer.domElement.style.cursor = cuerpo ? 'pointer' : 'default';
}
renderer.domElement.addEventListener('pointermove', onPointerMoveEscena);

// Distancia de acercamiento para centrarCamaraEnCuerpo: normalmente 9 veces
// el radio del hitbox, pero si el cuerpo clickeado tiene lunas propias (p.
// ej. Júpiter), se amplía para que también entren en el encuadre — si no,
// quedarían fuera de cámara pese a estar visibles en la escena.
function distanciaEnfoque(cuerpo) {
    const radioHitbox = cuerpo.meshRaycast.geometry.parameters.radius;
    const radioVisual = radioVisualDeCuerpo(cuerpo);
    let distanciaMaxLuna = 0;

    if (ultimosCuerpos) {
        Object.keys(ultimosCuerpos).forEach(otroNombre => {
            const otroDatos = ultimosCuerpos[otroNombre];
            if (otroDatos.cuerpo_padre === cuerpo.nombre && posicionesPorNombre.has(otroNombre)) {
                const distancia = posicionesPorNombre.get(otroNombre).distanceTo(cuerpo.meshRaycast.position);
                distanciaMaxLuna = Math.max(distanciaMaxLuna, distancia);
            }
        });
    }

    // La distancia principal se basa en el radio VISUAL real de la esfera
    // (no en el del hitbox — desde que el hitbox pasó a ser proporcional al
    // radio visual con distintos factores según categoría/modo, ya no era
    // un buen indicador de "qué tan grande se ve el cuerpo en pantalla", y
    // la cámara terminaba quedando demasiado lejos como para distinguir la
    // esfera con claridad). 4x el radio deja la esfera ocupando una buena
    // parte de la pantalla sin llegar a recortarse.
    const distanciaPorRadioVisual = radioVisual * 4;
    // Salvaguarda: nunca menos que un par de veces el hitbox, para cuerpos
    // donde el hitbox termina siendo más grande que el radio visual.
    const distanciaMinimaHitbox = radioHitbox * 2;

    // El piso absoluto es chico a propósito (no 1.2 como antes): ese valor
    // dominaba por completo en escala real, dejando la cámara igual de
    // lejos sin importar el cuerpo — la protección real contra quedar
    // pegado/adentro de la esfera ya la da controls.minDistance, calculado
    // aparte en centrarCamaraEnCuerpo.
    return Math.max(distanciaPorRadioVisual, distanciaMinimaHitbox, distanciaMaxLuna * 1.4, 0.01);
}

// Radio visual REAL de la esfera de un cuerpo (no el del hitbox, que puede
// ser distinto) — se usa para no dejar que la cámara pueda meterse dentro
// de la esfera al hacer zoom (ver centrarCamaraEnCuerpo). null para el
// baricentro (no tiene "datos"), que usa su propio radio fijo.
function radioVisualDeCuerpo(cuerpo) {
    if (!cuerpo.datos) return RADIO_BARICENTRO;
    return calcularRadioVisual(cuerpo.datos);
}

// Distancia base ("por defecto") de la última vez que se llamó a
// centrarCamaraEnCuerpo, junto con el nombre de ese cuerpo — se usa para
// preservar el zoom manual del usuario cuando se vuelve a enfocar el MISMO
// cuerpo tras una reconstrucción (ver reconstruirConEscalaActual), en vez
// de resetear siempre a la distancia calculada por distanciaEnfoque().
let ultimaDistanciaEnfoqueBase = null;

// "preservarZoom": true solo cuando quien llama es una RECONSTRUCCIÓN (no
// una selección nueva del usuario) — si además el cuerpo es el mismo que ya
// estaba enfocado, se mantiene la proporción de zoom manual en vez de
// volver a la distancia por defecto.
function centrarCamaraEnCuerpo(cuerpo, preservarZoom = false) {
    const esMismoCuerpoQueAntes = preservarZoom && nombreCuerpoEnfocado === cuerpo.nombre;
    nombreCuerpoEnfocado = cuerpo.nombre;
    // Si el cuerpo recién seleccionado es el que tenía el wireframe
    // encendido por un hover previo (p. ej. justo antes de clickearlo), se
    // apaga de inmediato acá — sin esto quedaría encendido hasta el próximo
    // pointermove, ya que el evento de click no dispara ese handler.
    if (wireframeActivo === cuerpo.wireframe) {
        wireframeActivo.visible = false;
        wireframeActivo = null;
    }
    // La memoria de zoom del encuadre "sistema completo" ya no aplica: a
    // partir de acá la cámara se relaciona con la distancia a ESTE cuerpo,
    // no con distanciaVisualMaxima. Si más adelante se vuelve a la vista
    // general (ver reconstruirConEscalaActual), conviene que arranque de la
    // distancia por defecto en vez de un factor de zoom que ya no tiene
    // sentido en ese contexto.
    ultimaDistanciaEncuadre = null;

    const posicion = cuerpo.meshRaycast.position;

    const direccion = camera.position.clone().sub(controls.target);
    if (direccion.lengthSq() === 0) {
        direccion.set(0, 0.4, 0.9);
    }
    direccion.normalize();

    const distanciaBase = distanciaEnfoque(cuerpo);
    let distanciaCamara = distanciaBase;

    if (esMismoCuerpoQueAntes && ultimaDistanciaEnfoqueBase) {
        const distanciaActual = camera.position.distanceTo(controls.target);
        const factorZoom = distanciaActual / ultimaDistanciaEnfoqueBase;
        distanciaCamara = distanciaBase * factorZoom;
    }
    ultimaDistanciaEnfoqueBase = distanciaBase;

    controls.target.copy(posicion);
    camera.position.copy(posicion).addScaledVector(direccion, distanciaCamara);

    // El límite de acercamiento (minDistance) se ajusta al radio REAL de la
    // esfera de este cuerpo específico, dejando un colchón chico (2% del
    // radio) respecto a la SUPERFICIE (minDistance se mide desde el centro,
    // por eso el +colchón y no solo el radio). Sin esto, minDistance
    // quedaba fijo en un valor global sin relación con el tamaño de lo que
    // se está mirando: en cuerpos grandes (p. ej. el Sol en escala
    // exagerada, radio 3) la cámara podía terminar DENTRO de la esfera
    // antes de llegar al límite.
    const radioSuperficie = radioVisualDeCuerpo(cuerpo);
    const colchonSuperficie = Math.max(radioSuperficie * 0.02, 0.0001);
    controls.minDistance = radioSuperficie + colchonSuperficie;

    // El "near" plane TIENE que quedar más cerca que el colchón de arriba
    // (si no, el propio plano de recorte termina dentro de la esfera al
    // acercar al máximo, cortándola literalmente — el bug real detrás del
    // "recorte" reportado). Con 0.3 del colchón queda un margen de
    // seguridad de ~3x respecto al colchón real, sin importar qué tan chico
    // sea ese colchón.
    camera.near = Math.max(colchonSuperficie * 0.3, 0.00005);
    camera.updateProjectionMatrix();

    controls.update();
}

function onClickEscena(event) {
    actualizarMouse(event);
    const cuerpo = cuerpoBajoElMouse();
    if (cuerpo) {
        mostrarInfoCuerpo(cuerpo.nombre, cuerpo.datos);
        // true: si es el mismo cuerpo que ya estaba enfocado (clickearlo de
        // nuevo), preserva el zoom manual en vez de resetear a la distancia
        // por defecto. Si es un cuerpo distinto, no tiene efecto: siempre
        // usa el encuadre por defecto para ese cuerpo nuevo.
        centrarCamaraEnCuerpo(cuerpo, true);
    }
}
renderer.domElement.addEventListener('click', onClickEscena);

// ============================================================
// 11. Inicializar llamada y bucle de render
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
