import * as THREE from "three";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

const BASE_SPEED = 0.003;
const DAMPING = 0.94;
const baseScale = 2.4 / (2.15 * 2);
const BALL_SCALE = 2.8;

const SECTIONS = {
  hero: { x: 0, y: -4.2, z: -1, scale: BALL_SCALE },
  product: { x: 2.8, y: -0.2, z: -3, scale: BALL_SCALE * 0.65 },
  solutions: { x: -2.8, y: -0.2, z: -3, scale: BALL_SCALE * 0.65 },
  pricing: { x: 0, y: 0, z: -4, scale: BALL_SCALE * 1.5 },
  usecases: { x: 2.8, y: -0.2, z: -3, scale: BALL_SCALE * 0.65 },
  contact: { x: 0, y: -4.0, z: -2, scale: BALL_SCALE * 0.9 },
} as const;

type SectionKey = keyof typeof SECTIONS;

const TEXTURES = {
  map: "/textures/planets/earth_atmos_2048.jpg",
  specular: "/textures/planets/earth_specular_2048.jpg",
  normal: "/textures/planets/earth_normal_2048.jpg",
  emissive: "/textures/planets/earth_lights_2048.png",
  clouds: "/textures/planets/earth_clouds_1024.png",
};

function showEarthFallback(): void {
  const fallback = document.getElementById("earth-fallback");
  if (fallback) fallback.hidden = false;
  const canvas = document.getElementById("earth-canvas");
  if (canvas) canvas.setAttribute("hidden", "");
}

function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button, a, input, select, textarea, label, summary"));
}

function sectionFromHash(): SectionKey {
  const hash = window.location.hash.replace("#", "");
  if (hash === "advantages") return "solutions";
  if (hash === "pricing") return "pricing";
  if (hash === "about") return "contact";
  return "hero";
}

export function mountVoicePilotEarth(): () => void {
  const canvas = document.getElementById("earth-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    showEarthFallback();
    return () => {};
  }

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
  } catch {
    showEarthFallback();
    return () => {};
  }

  const gl = renderer.getContext();
  if (!gl) {
    showEarthFallback();
    renderer.dispose();
    return () => {};
  }

  gsap.registerPlugin(ScrollTrigger);

  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = reducedQuery.matches;
  let raf = 0;
  let running = true;
  let dragging = false;
  let dragMode: "undecided" | "rotate" | "ignore" = "ignore";
  let released = false;
  let lastX = 0;
  let lastY = 0;
  let autoVel = { x: 0, y: BASE_SPEED };
  let vel = { x: 0, y: BASE_SPEED };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0, 12);

  scene.add(new THREE.AmbientLight(0x1a2642, 4.0));
  const edge = new THREE.DirectionalLight(0x00e5ff, 4.0);
  edge.position.set(-6, 4, -2);
  scene.add(edge);
  const fill = new THREE.DirectionalLight(0x6a8ab0, 4.0);
  fill.position.set(5, 3, 4);
  scene.add(fill);

  const ball = new THREE.Group();
  const spin = new THREE.Group();
  ball.add(spin);
  scene.add(ball);

  const targetPos = new THREE.Vector3();
  const targetScale = new THREE.Vector3(1, 1, 1);

  function applySection(key: SectionKey, immediate: boolean): void {
    const section = SECTIONS[key];
    const xMul = window.innerWidth < 768 ? 0.4 : 1;
    targetPos.set(section.x * xMul, section.y, section.z);
    const scale = section.scale * baseScale;
    targetScale.set(scale, scale, scale);
    if (immediate || reduced) {
      ball.position.copy(targetPos);
      ball.scale.copy(targetScale);
    }
  }

  applySection(sectionFromHash(), true);

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");

  function loadMap(url: string, color: boolean): THREE.Texture {
    const texture = loader.load(url);
    if (color) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(2.0, 64, 64),
    new THREE.MeshPhongMaterial({
      map: loadMap(TEXTURES.map, true),
      specularMap: loadMap(TEXTURES.specular, false),
      normalMap: loadMap(TEXTURES.normal, false),
      emissiveMap: loadMap(TEXTURES.emissive, true),
      emissive: 0xffffee,
      emissiveIntensity: 2.5,
      specular: 0x333333,
      shininess: 15,
    }),
  );
  spin.add(earth);

  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(2.03, 64, 64),
    new THREE.MeshPhongMaterial({
      map: loadMap(TEXTURES.clouds, true),
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  spin.add(clouds);

  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = 512;
  glowCanvas.height = 512;
  const glowContext = glowCanvas.getContext("2d");
  if (glowContext) {
    const gradient = glowContext.createRadialGradient(256, 256, 190, 256, 256, 256);
    gradient.addColorStop(0, "rgba(202, 245, 255, 0.49)");
    gradient.addColorStop(1, "rgba(0, 210, 255, 0.0)");
    glowContext.fillStyle = gradient;
    glowContext.fillRect(0, 0, 512, 512);
  }
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture,
      blending: THREE.AdditiveBlending,
      opacity: 0.45,
      transparent: true,
      depthWrite: false,
    }),
  );
  sprite.scale.set(4.8, 4.8, 1);
  sprite.position.set(0, 0, -0.1);
  ball.add(sprite);

  function resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    const active = document.querySelector<HTMLElement>(".section.is-earth");
    const key = (active?.dataset.ball as SectionKey | undefined) ?? sectionFromHash();
    if (key in SECTIONS) applySection(key, reduced);
  }

  function markSection(key: SectionKey): void {
    document.querySelectorAll<HTMLElement>(".section[data-ball]").forEach((section) => {
      section.classList.toggle("is-earth", section.dataset.ball === key);
    });
  }

  function goTo(key: SectionKey): void {
    if (!(key in SECTIONS)) return;
    markSection(key);
    applySection(key, reduced);
  }

  const triggers = (Object.keys(SECTIONS) as SectionKey[]).flatMap((key) => {
    const trigger = document.querySelector<HTMLElement>(`[data-ball="${key}"]`);
    if (!trigger) return [];
    return [
      ScrollTrigger.create({
        trigger,
        start: "top 65%",
        end: "bottom 35%",
        onEnter: () => goTo(key),
        onEnterBack: () => goTo(key),
      }),
    ];
  });

  function onSectionEvent(event: Event): void {
    const detail = (event as CustomEvent<{ ball?: SectionKey }>).detail;
    if (detail?.ball && detail.ball in SECTIONS) goTo(detail.ball);
  }

  function onPointerDown(event: PointerEvent): void {
    if (isInteractive(event.target)) {
      dragMode = "ignore";
      return;
    }
    dragging = true;
    released = false;
    dragMode = "undecided";
    lastX = event.clientX;
    lastY = event.clientY;
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging || dragMode === "ignore") return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    if (dragMode === "undecided") {
      if (Math.hypot(dx, dy) < 6) return;
      dragMode = Math.abs(dx) > Math.abs(dy) ? "rotate" : "ignore";
      if (dragMode !== "rotate") return;
    }
    lastX = event.clientX;
    lastY = event.clientY;
    vel.x = dy * 0.005;
    vel.y = dx * 0.005;
    if (!reduced) {
      spin.rotation.x += vel.x;
      spin.rotation.y += vel.y;
    }
  }

  function onPointerUp(): void {
    if (!dragging) return;
    dragging = false;
    if (dragMode === "rotate") released = true;
    dragMode = "ignore";
  }

  function tick(): void {
    if (!running) return;
    if (document.hidden) {
      raf = 0;
      return;
    }
    if (!reduced && !dragging) {
      vel.x *= DAMPING;
      vel.y = BASE_SPEED + (vel.y - BASE_SPEED) * DAMPING;
      if (released && Math.abs(vel.x) < 0.00015 && Math.abs(vel.y - BASE_SPEED) < 0.00015) {
        autoVel = { x: 0, y: BASE_SPEED };
        vel.x = autoVel.x;
        vel.y = autoVel.y;
        released = false;
      }
      spin.rotation.x += vel.x;
      spin.rotation.y += vel.y;
    }
    if (reduced) {
      ball.position.copy(targetPos);
      ball.scale.copy(targetScale);
    } else {
      ball.position.lerp(targetPos, 0.05);
      ball.scale.lerp(targetScale, 0.05);
    }
    renderer.render(scene, camera);
    raf = window.requestAnimationFrame(tick);
  }

  function onVisibility(): void {
    if (!running) return;
    if (document.hidden) {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      return;
    }
    if (!raf) raf = window.requestAnimationFrame(tick);
  }

  function onMotionChange(): void {
    reduced = reducedQuery.matches;
    if (reduced) {
      vel = { x: 0, y: 0 };
      ball.position.copy(targetPos);
      ball.scale.copy(targetScale);
    } else if (vel.y === 0 && vel.x === 0) {
      autoVel = { x: 0, y: BASE_SPEED };
      vel = { x: autoVel.x, y: autoVel.y };
    }
  }

  function onContextLost(event: Event): void {
    event.preventDefault();
    showEarthFallback();
  }

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("voicepilot:section", onSectionEvent);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("webglcontextlost", onContextLost);
  reducedQuery.addEventListener("change", onMotionChange);
  raf = window.requestAnimationFrame(tick);
  ScrollTrigger.refresh();

  return () => {
    running = false;
    if (raf) window.cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    window.removeEventListener("voicepilot:section", onSectionEvent);
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    reducedQuery.removeEventListener("change", onMotionChange);
    triggers.forEach((trigger) => trigger.kill());
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material.dispose();
      } else if (object instanceof THREE.Sprite) {
        object.material.dispose();
      }
    });
    glowTexture.dispose();
    renderer.dispose();
  };
}
