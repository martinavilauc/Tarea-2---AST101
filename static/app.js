// ============================================================
// 1. Configuración de la escena 3D
// ============================================================
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 3000);
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
// 2. Escala de distancias (no lineal a propósito)
// ============================================================
// Con 1 unidad = X km fijo, Mercurio (~58 millones de km) y Neptuno
// (~4.500 millones de km) quedan en una proporción de ~77:1. Eso obliga a
// elegir entre ver bien los planetas interiores (y perder a Urano/Neptuno
// fuera de cámara) o alejar tanto la cámara que Mercurio-Marte quedan
// pegados al marcador del baricentro y se confunden con él.
//
// Para evitarlo, la distancia visual de cada cuerpo se calcula como
// UNIDADES_POR_RAIZ_UA * sqrt(distancia_en_UA). La raíz cuadrada comprime
// las distancias grandes mucho más que las chicas, así que el orden y la
// separación relativa entre planetas se mantiene, pero la relación
// interior/exterior baja de 77:1 a menos de 9:1. Ya no son distancias
// reales, igual que los radios de los cuerpos (ver main.py) tampoco están
// a escala real de tamaño.
const KM_POR_UA = 149597870.7;
const UNIDADES_POR_RAIZ_UA = 14;

function escalarDistancia(distanciaKm) {
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
// Lista de objetos clickeables: { mesh, nombre }. Se completa en cargarSistemaSolar().
const cuerposInteractivos = [];

const marcadorBaricentro = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
);
marcadorBaricentro.position.set(0, 0, 0);
scene.add(marcadorBaricentro);
cuerposInteractivos.push({ mesh: marcadorBaricentro, nombre: "Baricentro del Sistema Solar" });

// ============================================================
// 5. Consultar datos al backend y renderizar planetas (incluido el Sol)
// ============================================================
const elCargando = document.getElementById('cargando');
const elBannerError = document.getElementById('banner-error');

function mostrarError(mensaje) {
    elBannerError.textContent = mensaje;
    elBannerError.style.display = 'block';
}

async function cargarSistemaSolar() {
    let respuestaJson;
    try {
        const res = await fetch('/api/sistema-solar');
        if (!res.ok) {
            throw new Error(`El servidor respondió con status ${res.status}`);
        }
        respuestaJson = await res.json();
    } catch (error) {
        console.error("No se pudo contactar a /api/sistema-solar:", error);
        mostrarError(
            "No se pudo conectar con el backend (/api/sistema-solar).\n" +
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

    nombres.forEach(nombre => {
        const data = cuerpos[nombre];
        const coords = data.coordenadas;
        const elementos = data.elementos_orbitales; // null para el Sol (o si Horizons no los pudo leer)

        // El Sol se autoilumina (no necesita luz); los planetas sí, para que
        // se note el lado iluminado por el Sol.
        const esSol = nombre === "Sol";
        const geo = new THREE.SphereGeometry(data.radio, 32, 32);
        const mat = esSol
            ? new THREE.MeshBasicMaterial({ color: data.color })
            : new THREE.MeshStandardMaterial({ color: data.color, roughness: 0.9, metalness: 0 });
        const mesh = new THREE.Mesh(geo, mat);

        // Factor de escala: si hay elementos orbitales, se usa el semieje
        // mayor de ESE planeta (así la posición queda coherente con su
        // propio aro de órbita). Si no hay (Sol, o falló la consulta de
        // elementos), se usa la distancia instantánea del propio cuerpo.
        const distanciaRealKm = Math.sqrt(coords.x ** 2 + coords.y ** 2 + coords.z ** 2);
        let factor = 0;
        if (elementos) {
            factor = factorEscalaOrbita(elementos.semieje_mayor_km);
        } else if (distanciaRealKm > 0) {
            factor = escalarDistancia(distanciaRealKm) / distanciaRealKm;
        }

        // Mismo mapeo de ejes que usa el aro de órbita: X real -> x escena,
        // Z real -> y escena (altura), Y real -> z escena.
        mesh.position.set(coords.x * factor, coords.z * factor, coords.y * factor);
        scene.add(mesh);

        if (esSol) {
            luzSol.position.copy(mesh.position);
        }

        cuerposInteractivos.push({ mesh, nombre });

        if (elementos) {
            const lineaOrbita = crearLineaOrbita(elementos, data.color);
            scene.add(lineaOrbita);
        }
    });

    elCargando.style.display = 'none';
}

// ============================================================
// 6. Click sobre un cuerpo -> mostrar su nombre
// ============================================================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tooltip = document.getElementById('tooltip');

function onClickEscena(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const meshes = cuerposInteractivos.map(c => c.mesh);
    const intersecciones = raycaster.intersectObjects(meshes);

    if (intersecciones.length > 0) {
        const meshSeleccionado = intersecciones[0].object;
        const cuerpo = cuerposInteractivos.find(c => c.mesh === meshSeleccionado);
        tooltip.textContent = cuerpo.nombre;
        tooltip.style.left = `${event.clientX}px`;
        tooltip.style.top = `${event.clientY}px`;
        tooltip.style.display = 'block';
    } else {
        tooltip.style.display = 'none';
    }
}
renderer.domElement.addEventListener('click', onClickEscena);

// ============================================================
// 7. Inicializar llamada y bucle de render
// ============================================================
cargarSistemaSolar();

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
