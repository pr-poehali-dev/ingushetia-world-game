import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

// ===== Данные мира: города, реки, маршруты =====
interface City {
  name: string;
  x: number; // координата X на карте
  z: number; // координата Z на карте
  region: 'ingush' | 'osetia';
}

// Города Ингушетии и Северной Осетии (координаты — условные, под игровой мир)
const CITIES: City[] = [
  { name: 'Назрань', x: -120, z: -40, region: 'ingush' },
  { name: 'Магас', x: -90, z: -20, region: 'ingush' },
  { name: 'Карабулак', x: -60, z: -60, region: 'ingush' },
  { name: 'Малгобек', x: -150, z: -110, region: 'ingush' },
  { name: 'Владикавказ', x: 90, z: 30, region: 'osetia' },
  { name: 'Чермен', x: 20, z: -10, region: 'osetia' },
];

// ===== Квесты =====
interface Quest {
  id: number;
  title: string;
  desc: string;
  reward: number;
  from: string; // город старта
  to: string; // город назначения
}

const QUESTS: Quest[] = [
  { id: 1, title: 'Доставка груза', desc: 'Отвези груз из Назрани в Чермен', reward: 1500, from: 'Назрань', to: 'Чермен' },
  { id: 2, title: 'Погоня по трассе', desc: 'Догони нарушителя на трассе «Кавказ»', reward: 2500, from: 'Карабулак', to: 'Владикавказ' },
  { id: 3, title: 'Магас → Владикавказ', desc: 'Проедь маршрут между столицами', reward: 2000, from: 'Магас', to: 'Владикавказ' },
  { id: 4, title: 'Горы Джейраха', desc: 'Поднимись в горный район к башням', reward: 3000, from: 'Назрань', to: 'Магас' },
];

const Index = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const miniMapRef = useRef<HTMLCanvasElement>(null);
  const carPosRef = useRef({ x: -120, z: -40, angle: 0 });

  // Игровое состояние для HUD
  const [money, setMoney] = useState(5000);
  const [level, setLevel] = useState(1);
  const [tripTime, setTripTime] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [activeQuest, setActiveQuest] = useState<number | null>(1);
  const [done, setDone] = useState<number[]>([]);
  const [carColorIdx, setCarColorIdx] = useState(0);
  const [hint, setHint] = useState('Цель: доедь до зелёного флажка');

  const CAR_COLORS = [0xff3b30, 0x007aff, 0x34c759, 0xffcc00, 0xeeeeee, 0x1a1a1a];

  // refs для связи логики с React-состоянием
  const stateRef = useRef({ money: 5000, level: 1, activeQuest: 1 as number | null, done: [] as number[], carColor: 0xff3b30 });
  stateRef.current.money = money;
  stateRef.current.activeQuest = activeQuest;
  stateRef.current.done = done;

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;

    // ===== Сцена, камера, рендер =====
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // небо
    scene.fog = new THREE.Fog(0x87ceeb, 200, 700); // туман на горизонте

    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 2000);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    // ===== Освещение (солнце + дневной цикл) =====
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 800;
    sun.shadow.camera.left = -400;
    sun.shadow.camera.right = 400;
    sun.shadow.camera.top = 400;
    sun.shadow.camera.bottom = -400;
    scene.add(sun);
    scene.add(sun.target);

    // Визуальный диск солнца
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(15, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffdd55 })
    );
    scene.add(sunMesh);

    // ===== Земля (равнины и холмы) =====
    const groundGeo = new THREE.PlaneGeometry(1600, 1600, 80, 80);
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      // лёгкая холмистость с помощью синусов
      const h = Math.sin(x * 0.01) * 6 + Math.cos(y * 0.012) * 6 + Math.sin(x * 0.03 + y * 0.02) * 3;
      pos.setZ(i, h);
    }
    groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(
      groundGeo,
      new THREE.MeshStandardMaterial({ color: 0x6ab150, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // ===== Горы Джейраха (на юге, фон) =====
    const mountainMat = new THREE.MeshStandardMaterial({ color: 0x8a8d92, roughness: 1, flatShading: true });
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    for (let i = 0; i < 14; i++) {
      const h = 120 + Math.random() * 160;
      const r = 60 + Math.random() * 60;
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), mountainMat);
      m.position.set(-300 + i * 60, h / 2 - 10, 220 + Math.random() * 80);
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
      // снежная шапка
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.4, h * 0.35, 6), snowMat);
      cap.position.set(m.position.x, h - 10 - h * 0.15, m.position.z);
      scene.add(cap);
    }

    // ===== Башни Джейраха (горные сторожевые башни) =====
    const towerMat = new THREE.MeshStandardMaterial({ color: 0xb8a888, roughness: 1 });
    for (let i = 0; i < 5; i++) {
      const tw = new THREE.Mesh(new THREE.BoxGeometry(8, 40, 8), towerMat);
      tw.position.set(-200 + i * 50, 20, 150 + Math.random() * 30);
      tw.castShadow = true;
      scene.add(tw);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(7, 12, 4), towerMat);
      roof.position.set(tw.position.x, 46, tw.position.z);
      roof.rotation.y = Math.PI / 4;
      scene.add(roof);
    }

    // ===== Реки Сунжа и Терек =====
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x3b82d4, roughness: 0.3, metalness: 0.2 });
    const sunzha = new THREE.Mesh(new THREE.BoxGeometry(420, 0.5, 14), waterMat);
    sunzha.position.set(-80, 0.5, -90);
    sunzha.rotation.y = 0.3;
    scene.add(sunzha);
    const terek = new THREE.Mesh(new THREE.BoxGeometry(380, 0.5, 16), waterMat);
    terek.position.set(60, 0.5, 80);
    terek.rotation.y = -0.4;
    scene.add(terek);

    // ===== Трасса «Кавказ» (соединяет города) =====
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffd400 });
    function buildRoad(a: City, b: City) {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      const road = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, 12), roadMat);
      road.position.set((a.x + b.x) / 2, 0.3, (a.z + b.z) / 2);
      road.rotation.y = -Math.atan2(dz, dx);
      road.receiveShadow = true;
      scene.add(road);
      // разметка
      const dash = new THREE.Mesh(new THREE.BoxGeometry(len, 0.32, 0.6), lineMat);
      dash.position.set((a.x + b.x) / 2, 0.4, (a.z + b.z) / 2);
      dash.rotation.y = road.rotation.y;
      scene.add(dash);
    }
    // цепочка трассы «Кавказ»
    const c = (n: string) => CITIES.find((x) => x.name === n)!;
    buildRoad(c('Малгобек'), c('Назрань'));
    buildRoad(c('Назрань'), c('Магас'));
    buildRoad(c('Магас'), c('Карабулак'));
    buildRoad(c('Карабулак'), c('Чермен'));
    buildRoad(c('Чермен'), c('Владикавказ'));
    buildRoad(c('Назрань'), c('Карабулак'));

    // ===== Города (здания + табличка-флажок) =====
    const flags: { name: string; mesh: THREE.Mesh; x: number; z: number }[] = [];
    CITIES.forEach((city) => {
      // дома вокруг центра города
      for (let i = 0; i < 12; i++) {
        const w = 6 + Math.random() * 6;
        const hh = 8 + Math.random() * 24;
        const d = 6 + Math.random() * 6;
        const hue = city.region === 'osetia' ? 0xd9c7a8 : 0xc9b89a;
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(w, hh, d),
          new THREE.MeshStandardMaterial({ color: hue, roughness: 0.95 })
        );
        const ang = Math.random() * Math.PI * 2;
        const rad = 12 + Math.random() * 30;
        b.position.set(city.x + Math.cos(ang) * rad, hh / 2, city.z + Math.sin(ang) * rad);
        b.castShadow = true;
        b.receiveShadow = true;
        scene.add(b);
        // крыша
        const roof = new THREE.Mesh(
          new THREE.ConeGeometry(w * 0.8, 5, 4),
          new THREE.MeshStandardMaterial({ color: 0x8b3a2f })
        );
        roof.position.set(b.position.x, hh + 2.5, b.position.z);
        roof.rotation.y = Math.PI / 4;
        scene.add(roof);
      }
      // флажок-маркер города
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 30), new THREE.MeshStandardMaterial({ color: 0x333333 }));
      pole.position.set(city.x, 15, city.z);
      scene.add(pole);
      const flagMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 6),
        new THREE.MeshStandardMaterial({ color: 0x999999, side: THREE.DoubleSide })
      );
      flagMesh.position.set(city.x + 5, 27, city.z);
      scene.add(flagMesh);
      flags.push({ name: city.name, mesh: flagMesh, x: city.x, z: city.z });
    });

    // ===== Деревья =====
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4423 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, flatShading: true });
    for (let i = 0; i < 220; i++) {
      const x = (Math.random() - 0.5) * 900;
      const z = (Math.random() - 0.5) * 700 - 50;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, 6), trunkMat);
      trunk.position.set(x, 3, z);
      trunk.castShadow = true;
      scene.add(trunk);
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(4, 10, 7), leafMat);
      leaf.position.set(x, 10, z);
      leaf.castShadow = true;
      scene.add(leaf);
    }

    // ===== Машина игрока =====
    function createCar(color: number) {
      const car = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(5, 2, 9),
        new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.6 })
      );
      body.position.y = 2;
      body.castShadow = true;
      car.add(body);
      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(4, 1.8, 4.5),
        new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.3 })
      );
      cabin.position.set(0, 3.6, -0.5);
      cabin.castShadow = true;
      car.add(cabin);
      // колёса
      const wheelGeo = new THREE.CylinderGeometry(1.3, 1.3, 1, 12);
      const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
      const offsets = [[-2.5, -3], [2.5, -3], [-2.5, 3], [2.5, 3]];
      offsets.forEach(([wx, wz]) => {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wx, 1.2, wz);
        car.add(wheel);
      });
      // фары
      const head = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.6, 0.3), new THREE.MeshBasicMaterial({ color: 0xffffcc }));
      head.position.set(0, 2.2, 4.6);
      car.add(head);
      return car;
    }

    let car = createCar(CAR_COLORS[carColorIdx]);
    scene.add(car);
    car.position.set(carPosRef.current.x, 0, carPosRef.current.z);

    // ===== Управление с клавиатуры =====
    const keys: Record<string, boolean> = {};
    const onKeyDown = (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = true; };
    const onKeyUp = (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // ===== Мини-карта =====
    const mini = miniMapRef.current!.getContext('2d')!;
    function drawMiniMap(carX: number, carZ: number, carAngle: number) {
      const W = 180, H = 180, scale = 0.45;
      mini.clearRect(0, 0, W, H);
      mini.fillStyle = '#1a2e1a';
      mini.fillRect(0, 0, W, H);
      const toCanvas = (wx: number, wz: number) => ({
        cx: W / 2 + (wx - carX) * scale,
        cy: H / 2 + (wz - carZ) * scale,
      });
      // дороги
      mini.strokeStyle = '#555';
      mini.lineWidth = 3;
      const drawSeg = (a: City, b: City) => {
        const p1 = toCanvas(a.x, a.z), p2 = toCanvas(b.x, b.z);
        mini.beginPath(); mini.moveTo(p1.cx, p1.cy); mini.lineTo(p2.cx, p2.cy); mini.stroke();
      };
      drawSeg(c('Малгобек'), c('Назрань')); drawSeg(c('Назрань'), c('Магас'));
      drawSeg(c('Магас'), c('Карабулак')); drawSeg(c('Карабулак'), c('Чермен'));
      drawSeg(c('Чермен'), c('Владикавказ')); drawSeg(c('Назрань'), c('Карабулак'));
      // города
      CITIES.forEach((ct) => {
        const p = toCanvas(ct.x, ct.z);
        mini.fillStyle = ct.region === 'osetia' ? '#ff9f43' : '#54a0ff';
        mini.beginPath(); mini.arc(p.cx, p.cy, 4, 0, Math.PI * 2); mini.fill();
      });
      // цель квеста
      const q = QUESTS.find((x) => x.id === stateRef.current.activeQuest);
      if (q) {
        const target = c(q.to);
        const p = toCanvas(target.x, target.z);
        mini.fillStyle = '#2ecc71';
        mini.beginPath(); mini.moveTo(p.cx, p.cy - 7); mini.lineTo(p.cx + 8, p.cy - 3); mini.lineTo(p.cx, p.cy + 1); mini.closePath(); mini.fill();
      }
      // игрок (стрелка)
      mini.save();
      mini.translate(W / 2, H / 2);
      mini.rotate(-carAngle);
      mini.fillStyle = '#fff';
      mini.beginPath(); mini.moveTo(0, -7); mini.lineTo(5, 6); mini.lineTo(-5, 6); mini.closePath(); mini.fill();
      mini.restore();
    }

    // ===== Игровой цикл =====
    let velocity = 0;
    let dayTime = 0.25; // 0..1 — время суток
    let trip = 0;
    let reached = false;
    const clock = new THREE.Clock();
    let frameId = 0;

    function animate() {
      frameId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);

      // ----- управление машиной -----
      const accel = 60, maxSpeed = 90, friction = 0.96, turnRate = 1.8;
      if (keys['w'] || keys['arrowup']) velocity += accel * dt;
      if (keys['s'] || keys['arrowdown']) velocity -= accel * dt;
      velocity *= friction;
      velocity = Math.max(-maxSpeed * 0.5, Math.min(maxSpeed, velocity));
      if (Math.abs(velocity) > 0.5) {
        const dir = velocity > 0 ? 1 : -1;
        if (keys['a'] || keys['arrowleft']) carPosRef.current.angle += turnRate * dt * dir;
        if (keys['d'] || keys['arrowright']) carPosRef.current.angle -= turnRate * dt * dir;
      }
      carPosRef.current.x -= Math.sin(carPosRef.current.angle) * velocity * dt;
      carPosRef.current.z -= Math.cos(carPosRef.current.angle) * velocity * dt;

      car.position.set(carPosRef.current.x, 0, carPosRef.current.z);
      car.rotation.y = carPosRef.current.angle;

      // ----- камера следует за машиной -----
      const camDist = 22, camHeight = 12;
      const camX = carPosRef.current.x + Math.sin(carPosRef.current.angle) * camDist;
      const camZ = carPosRef.current.z + Math.cos(carPosRef.current.angle) * camDist;
      camera.position.lerp(new THREE.Vector3(camX, camHeight, camZ), 0.1);
      camera.lookAt(carPosRef.current.x, 3, carPosRef.current.z);

      // ----- дневной цикл -----
      dayTime += dt * 0.01;
      if (dayTime > 1) dayTime = 0;
      const sunAngle = dayTime * Math.PI * 2;
      const sunY = Math.sin(sunAngle) * 350;
      const sunX = Math.cos(sunAngle) * 350;
      sun.position.set(sunX + carPosRef.current.x, Math.max(sunY, -50), 100 + carPosRef.current.z);
      sun.target.position.set(carPosRef.current.x, 0, carPosRef.current.z);
      sunMesh.position.copy(sun.position);
      const daylight = Math.max(0.1, Math.sin(sunAngle));
      sun.intensity = daylight * 1.2;
      ambient.intensity = 0.3 + daylight * 0.4;
      // цвет неба меняется
      const skyDay = new THREE.Color(0x87ceeb);
      const skyNight = new THREE.Color(0x0a1530);
      const sky = skyNight.clone().lerp(skyDay, daylight);
      scene.background = sky;
      (scene.fog as THREE.Fog).color = sky;

      // ----- проверка достижения цели квеста -----
      const q = QUESTS.find((x) => x.id === stateRef.current.activeQuest);
      if (q && !reached) {
        const target = c(q.to);
        const dist = Math.hypot(carPosRef.current.x - target.x, carPosRef.current.z - target.z);
        if (dist < 35) {
          reached = true;
          setMoney((m) => m + q.reward);
          setDone((d) => [...d, q.id]);
          setHint(`Квест «${q.title}» выполнен! +${q.reward} ₽`);
          setActiveQuest(null);
        }
      }

      // ----- HUD значения -----
      trip += dt;
      setTripTime(trip);
      setSpeed(Math.abs(Math.round(velocity)));

      drawMiniMap(carPosRef.current.x, carPosRef.current.z, carPosRef.current.angle);
      renderer.render(scene, camera);
    }
    animate();

    // адаптив
    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', onResize);

    // смена машины из React (через кастомное событие)
    const onChangeCar = (e: Event) => {
      const color = (e as CustomEvent).detail as number;
      scene.remove(car);
      car = createCar(color);
      car.position.set(carPosRef.current.x, 0, carPosRef.current.z);
      car.rotation.y = carPosRef.current.angle;
      scene.add(car);
    };
    window.addEventListener('changeCar', onChangeCar);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('changeCar', onChangeCar);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // смена цвета машины
  const switchCar = () => {
    const next = (carColorIdx + 1) % CAR_COLORS.length;
    setCarColorIdx(next);
    window.dispatchEvent(new CustomEvent('changeCar', { detail: CAR_COLORS[next] }));
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const carNames = ['Красная', 'Синяя', 'Зелёная', 'Жёлтая', 'Белая', 'Чёрная'];

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black font-['Rubik']">
      {/* 3D-сцена */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* ВЕРХНЯЯ ПАНЕЛЬ: деньги, уровень, время, скорость */}
      <div className="absolute top-0 left-0 right-0 flex justify-center pointer-events-none z-10 p-3">
        <div className="flex gap-3">
          <Stat icon="💰" label="Деньги" value={`${money.toLocaleString('ru')} ₽`} color="text-yellow-300" />
          <Stat icon="⭐" label="Уровень" value={`${level}`} color="text-sky-300" />
          <Stat icon="⏱" label="В пути" value={fmtTime(tripTime)} color="text-white" />
          <Stat icon="🚗" label="Скорость" value={`${speed} км/ч`} color="text-green-300" />
        </div>
      </div>

      {/* СПИСОК КВЕСТОВ (слева) */}
      <div className="absolute top-20 left-3 w-72 z-10">
        <div className="bg-black/65 backdrop-blur-md rounded-2xl border border-white/10 p-4 text-white shadow-2xl">
          <h2 className="text-sm font-bold tracking-widest text-orange-400 mb-3 uppercase">Квесты</h2>
          <div className="space-y-2">
            {QUESTS.map((q) => {
              const isDone = done.includes(q.id);
              const isActive = activeQuest === q.id;
              return (
                <button
                  key={q.id}
                  onClick={() => !isDone && setActiveQuest(q.id)}
                  className={`w-full text-left rounded-xl p-3 transition-all border ${
                    isDone
                      ? 'bg-green-900/40 border-green-500/30 opacity-60'
                      : isActive
                      ? 'bg-orange-500/20 border-orange-400/60'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{isDone ? '✅ ' : ''}{q.title}</span>
                    <span className="text-xs text-yellow-300 font-bold">+{q.reward}₽</span>
                  </div>
                  <p className="text-xs text-white/60 mt-1">{q.desc}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* МИНИ-КАРТА (правый верх) */}
      <div className="absolute top-20 right-3 z-10">
        <div className="bg-black/65 backdrop-blur-md rounded-2xl border border-white/10 p-2 shadow-2xl">
          <canvas ref={miniMapRef} width={180} height={180} className="rounded-xl" />
          <div className="text-center text-[10px] text-white/50 mt-1 tracking-widest uppercase">Карта мира</div>
        </div>
      </div>

      {/* ПОДСКАЗКА (центр снизу) */}
      <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10">
        <div className="bg-orange-500/90 text-white text-sm font-medium px-5 py-2 rounded-full shadow-lg animate-fade-in">
          {hint}
        </div>
      </div>

      {/* НИЖНЯЯ ПАНЕЛЬ: управление + смена машины */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-4">
        <div className="bg-black/65 backdrop-blur-md rounded-2xl border border-white/10 px-5 py-2 text-white text-xs flex gap-4 items-center">
          <span><kbd className="px-2 py-1 bg-white/10 rounded">W A S D</kbd> / стрелки — езда</span>
        </div>
        <button
          onClick={switchCar}
          className="bg-orange-500 hover:bg-orange-600 transition text-white font-semibold text-sm px-5 py-3 rounded-2xl shadow-lg"
        >
          🚙 Сменить машину: {carNames[carColorIdx]}
        </button>
      </div>

      {/* Подключаем шрифт */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&display=swap');`}</style>
    </div>
  );
};

// Виджет статистики в верхней панели
const Stat = ({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) => (
  <div className="bg-black/65 backdrop-blur-md rounded-2xl border border-white/10 px-4 py-2 text-center min-w-[90px] shadow-xl">
    <div className="text-[10px] text-white/50 uppercase tracking-wider">{icon} {label}</div>
    <div className={`text-lg font-bold ${color}`}>{value}</div>
  </div>
);

export default Index;
