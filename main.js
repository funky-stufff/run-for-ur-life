// Basic Nextbot-style chase demo using Three.js (no external controls helper)

let scene, camera, renderer;
let floor;
let playerVelocity = new THREE.Vector3();
let moveForward = false,
  moveBackward = false,
  moveLeft = false,
  moveRight = false;

let bot, botSpeed = 7;
const obstacles = [];
let clock = new THREE.Clock();
let started = false;
let elapsedSurvival = 0;
let gameOver = false;

// Simple manual first-person look state
let yaw = 0;
let pitch = 0;
let isPointerLocked = false;

// Mobile / touch controls (virtual joystick)
let isTouchDevice =
  "ontouchstart" in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;
let joystickActive = false;
let joystickCenter = { x: 0, y: 0 };
let joystickDir = { x: 0, y: 0 };

const timeValueEl = document.getElementById("timeValue");
const statusValueEl = document.getElementById("statusValue");
const finalScoreEl = document.getElementById("finalScore");

// Optional: custom face texture + sound
// Put your face image at ./assets/face.png and sounds in ./assets/
const ASSETS = {
  faceTexture: "./assets/face.png",
  chaseSound: "./assets/chase.mp3",
  endSound: "./assets/end.mp3",
  kissSound: "./assets/kiss-sfx.mp3",
};

let audioListener, chaseSound, endSound, kissSound;

init();

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050509);

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 1.6, 5);
  camera.rotation.order = "YXZ";

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  // Simple "building floor" – big plane with tiled material
  const floorSize = 200;
  const floorGeo = new THREE.PlaneGeometry(floorSize, floorSize);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x202028,
    metalness: 0.1,
    roughness: 0.9,
  });
  floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Some simple walls / columns hinting a large empty floor
  addSimpleEnvironment();

  // Lighting
  const hemi = new THREE.HemisphereLight(0xffffff, 0x202030, 0.7);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.7);
  dir.position.set(5, 10, 2);
  scene.add(dir);

  // Audio setup
  audioListener = new THREE.AudioListener();
  camera.add(audioListener);
  chaseSound = new THREE.Audio(audioListener);
  endSound = new THREE.Audio(audioListener);
  kissSound = new THREE.Audio(audioListener);
  const audioLoader = new THREE.AudioLoader();
  audioLoader.load(
    ASSETS.chaseSound,
    (buffer) => {
      chaseSound.setBuffer(buffer);
      chaseSound.setLoop(true);
      // Base volume; will be modulated dynamically based on distance.
      chaseSound.setVolume(0.6);
    },
    undefined,
    () => {
      console.warn("Chase sound not found, skipping audio.");
    }
  );

  audioLoader.load(
    ASSETS.endSound,
    (buffer) => {
      endSound.setBuffer(buffer);
      endSound.setLoop(false);
      endSound.setVolume(0.6);
    },
    undefined,
    () => {
      console.warn("End sound not found, skipping audio.");
    }
  );

  audioLoader.load(
    ASSETS.kissSound,
    (buffer) => {
      kissSound.setBuffer(buffer);
      kissSound.setLoop(false);
      kissSound.setVolume(0.8);
    },
    undefined,
    () => {
      console.warn("Kiss sound not found, skipping audio.");
    }
  );

  const startButton = document.getElementById("startButton");
  const retryButton = document.getElementById("retryButton");
  startButton.addEventListener("click", () => {
    // Always start the game on click; request pointer lock for mouse look.
    document.getElementById("overlay").style.display = "none";
    startGame();
    if (renderer && renderer.domElement.requestPointerLock) {
      renderer.domElement.requestPointerLock();
    }
  });

  // Pointer lock events
  const onPointerLockChange = () => {
    isPointerLocked = document.pointerLockElement === renderer.domElement;
    if (!isPointerLocked && started && !gameOver) {
      statusValueEl.textContent = "Paused";
    }
  };
  document.addEventListener("pointerlockchange", onPointerLockChange);

  // Input
  const onKeyDown = (event) => {
    switch (event.code) {
      case "ArrowUp":
      case "KeyW":
        moveForward = true;
        break;
      case "ArrowLeft":
      case "KeyA":
        moveLeft = true;
        break;
      case "ArrowDown":
      case "KeyS":
        moveBackward = true;
        break;
      case "ArrowRight":
      case "KeyD":
        moveRight = true;
        break;
    }
  };

  const onKeyUp = (event) => {
    switch (event.code) {
      case "ArrowUp":
      case "KeyW":
        moveForward = false;
        break;
      case "ArrowLeft":
      case "KeyA":
        moveLeft = false;
        break;
      case "ArrowDown":
      case "KeyS":
        moveBackward = false;
        break;
      case "ArrowRight":
      case "KeyD":
        moveRight = false;
        break;
    }
  };

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);

  // Mouse look (desktop)
  const onMouseMove = (event) => {
    if (!isPointerLocked) return;
    const sensitivity = 0.0025;
    yaw -= event.movementX * sensitivity;
    pitch -= event.movementY * sensitivity;
    const maxPitch = (Math.PI / 180) * 75; // limit to ~75 degrees up/down
    pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
    camera.rotation.set(pitch, yaw, 0, "YXZ");
  };
  document.addEventListener("mousemove", onMouseMove);

  // Touch controls (mobile): virtual joystick + swipe look
  if (isTouchDevice) {
    setupTouchControls();
  }

  if (retryButton) {
    retryButton.addEventListener("click", () => {
      restartGame();
    });
  }

  window.addEventListener("resize", onWindowResize);

  // Create chasing bot
  createBot();

  animate();
}

function addSimpleEnvironment() {
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x303040,
    metalness: 0.2,
    roughness: 0.8,
  });

  const wallHeight = 4;
  const wallThickness = 0.4;
  const areaSize = 40;

  const wallGeoLong = new THREE.BoxGeometry(areaSize, wallHeight, wallThickness);
  const wallGeoShort = new THREE.BoxGeometry(wallThickness, wallHeight, areaSize);

  const wall1 = new THREE.Mesh(wallGeoLong, wallMat);
  wall1.position.set(0, wallHeight / 2, -areaSize / 2);
  scene.add(wall1);
  obstacles.push(wall1);

  const wall2 = wall1.clone();
  wall2.position.set(0, wallHeight / 2, areaSize / 2);
  scene.add(wall2);
  obstacles.push(wall2);

  const wall3 = new THREE.Mesh(wallGeoShort, wallMat);
  wall3.position.set(-areaSize / 2, wallHeight / 2, 0);
  scene.add(wall3);
  obstacles.push(wall3);

  const wall4 = wall3.clone();
  wall4.position.set(areaSize / 2, wallHeight / 2, 0);
  scene.add(wall4);
  obstacles.push(wall4);

  // A few simple columns
  const colGeo = new THREE.BoxGeometry(1.2, wallHeight, 1.2);
  const positions = [
    [-10, 0, -10],
    [10, 0, -8],
    [-6, 0, 8],
    [6, 0, 10],
  ];
  positions.forEach(([x, y, z]) => {
    const col = new THREE.Mesh(colGeo, wallMat);
    col.position.set(x, wallHeight / 2, z);
    scene.add(col);
    obstacles.push(col);
  });
}

function createBot() {
  const size = 2;
  const geometry = new THREE.BoxGeometry(size, size, size);

  const loader = new THREE.TextureLoader();
  loader.load(
    ASSETS.faceTexture,
    (texture) => {
      const materials = [
        new THREE.MeshStandardMaterial({ color: 0x111111 }), // right
        new THREE.MeshStandardMaterial({ color: 0x111111 }), // left
        new THREE.MeshStandardMaterial({ color: 0x111111 }), // top
        new THREE.MeshStandardMaterial({ color: 0x111111 }), // bottom
        new THREE.MeshStandardMaterial({ map: texture }), // front (face)
        new THREE.MeshStandardMaterial({ color: 0x111111 }), // back
      ];
      bot = new THREE.Mesh(geometry, materials);
      finishBotSetup();
    },
    undefined,
    () => {
      // fallback – just a colored cube
      const material = new THREE.MeshStandardMaterial({
        color: 0xff3366,
        emissive: 0x550022,
      });
      bot = new THREE.Mesh(geometry, material);
      finishBotSetup();
    }
  );
}

function finishBotSetup() {
  bot.position.set(0, 1, -15);
  scene.add(bot);
}

function startGame() {
  started = true;
  gameOver = false;
  elapsedSurvival = 0;
  clock.start();
  statusValueEl.textContent = "Run!";
  const gameOverOverlay = document.getElementById("gameOver");
  if (gameOverOverlay) gameOverOverlay.style.display = "none";

  // Ensure AudioContext is running (some browsers suspend it until a user gesture)
  if (audioListener && audioListener.context && audioListener.context.state === "suspended") {
    audioListener.context.resume();
  }

  if (endSound && endSound.isPlaying) {
    endSound.stop();
  }
  if (kissSound && kissSound.isPlaying) {
    kissSound.stop();
  }

  if (chaseSound && chaseSound.buffer) {
    chaseSound.stop();
    chaseSound.play();
  }
}

function endGame() {
  gameOver = true;
  statusValueEl.textContent = "Shogani the Freakster Caught You 🫦🫢!";

  // Make sure audio context is active when ending
  if (audioListener && audioListener.context && audioListener.context.state === "suspended") {
    audioListener.context.resume();
  }

  if (chaseSound && chaseSound.isPlaying) {
    chaseSound.stop();
  }
  // Play kiss first (if available), then trigger end sound shortly after.
  if (kissSound && kissSound.buffer) {
    kissSound.stop();
    kissSound.play();
    // Fire end sound after a short delay instead of relying on onEnded,
    // to avoid missing the event on first play before everything is fully ready.
    setTimeout(() => {
      playEndSound();
    }, 900);
  } else {
    playEndSound();
  }

  if (finalScoreEl) {
    finalScoreEl.textContent = `${elapsedSurvival.toFixed(1)}`;
  }
  const gameOverOverlay = document.getElementById("gameOver");
  if (gameOverOverlay) {
    gameOverOverlay.style.display = "flex";
  }
}

function playEndSound() {
  if (!endSound) return;

  // Already loaded
  if (endSound.buffer) {
    endSound.stop();
    endSound.play();
    return;
  }

  // Lazy-load if buffer not ready yet (e.g., first quick death)
  const loader = new THREE.AudioLoader();
  loader.load(
    ASSETS.endSound,
    (buffer) => {
      endSound.setBuffer(buffer);
      endSound.setLoop(false);
      endSound.setVolume(0.6);
      endSound.stop();
      endSound.play();
    },
    undefined,
    () => {
      console.warn("Failed to lazy-load end sound.");
    }
  );
}

function restartGame() {
  // Reset basic state
  started = true;
  gameOver = false;
  elapsedSurvival = 0;
  clock.start();
  statusValueEl.textContent = "Run!";
  timeValueEl.textContent = "0.0s";

  // Reset camera
  camera.position.set(0, 1.6, 5);
  yaw = 0;
  pitch = 0;
  camera.rotation.set(0, 0, 0, "YXZ");

  // Reset bot if it exists
  if (bot) {
    bot.position.set(0, 1, -15);
  }

  const gameOverOverlay = document.getElementById("gameOver");
  if (gameOverOverlay) {
    gameOverOverlay.style.display = "none";
  }

  // Re-request pointer lock on desktop
  if (!isTouchDevice && renderer && renderer.domElement.requestPointerLock) {
    renderer.domElement.requestPointerLock();
  }

  // Reset/end any death sounds and (re)start chase loop
  if (endSound && endSound.isPlaying) {
    endSound.stop();
  }
  if (kissSound && kissSound.isPlaying) {
    kissSound.stop();
  }
  if (chaseSound && chaseSound.buffer) {
    chaseSound.stop();
    chaseSound.play();
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (started && !gameOver) {
    updatePlayer(delta);
    updateBot(delta);
    elapsedSurvival += delta;
    timeValueEl.textContent = `${elapsedSurvival.toFixed(1)}s`;
  }

  renderer.render(scene, camera);
}

function updatePlayer(delta) {
  const speed = 10;

  playerVelocity.set(0, 0, 0);
  if (moveForward) playerVelocity.z += 1;
  if (moveBackward) playerVelocity.z -= 1;
  if (moveLeft) playerVelocity.x -= 1;
  if (moveRight) playerVelocity.x += 1;

  if (playerVelocity.lengthSq() > 0) {
    playerVelocity.normalize().multiplyScalar(speed * delta);

    // Use camera's actual facing direction so controls stay consistent after rotation
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3().copy(forward).cross(new THREE.Vector3(0, 1, 0)).normalize();

    const move = new THREE.Vector3();
    move.addScaledVector(forward, playerVelocity.z);
    move.addScaledVector(right, playerVelocity.x);

    camera.position.add(move);
    camera.position.y = 1.6; // keep camera glued to "ground" height
    statusValueEl.textContent = "Running";
  } else {
    statusValueEl.textContent = "Idle";
  }

  // Keep player within area bounds
  const bounds = 18;
  const pos = camera.position;
  pos.x = THREE.MathUtils.clamp(pos.x, -bounds, bounds);
  pos.z = THREE.MathUtils.clamp(pos.z, -bounds, bounds);
}

function updateBot(delta) {
  if (!bot) return;

  const target = camera.position;
  const botPos = bot.position;

  const toPlayer = new THREE.Vector3().subVectors(target, botPos);
  const distance = toPlayer.length();

  if (distance < 1.5 && !gameOver) {
    endGame();
    return;
  }

  // Stronger proximity effect for chase sound (louder when close, fades fast)
  if (chaseSound && chaseSound.buffer && chaseSound.isPlaying) {
    const maxHearDist = 20; // beyond this, basically silent
    const t = THREE.MathUtils.clamp(1 - distance / maxHearDist, 0, 1);
    // Ease-in curve: small t -> much quieter, close t -> much louder
    const curved = t * t * t; // cubic for stronger change near player
    const minVol = 0.02;
    const maxVol = 0.9;
    const vol = THREE.MathUtils.lerp(minVol, maxVol, curved);
    chaseSound.setVolume(vol);
  }

  toPlayer.normalize();

  const currentSpeed = botSpeed + elapsedSurvival * 0.15;
  const moveStep = new THREE.Vector3().copy(toPlayer).multiplyScalar(currentSpeed * delta);
  const nextPos = new THREE.Vector3().copy(botPos).add(moveStep);

  // Simple collision against walls/columns using bounding boxes
  let blocked = false;
  const botRadius = 1.1;
  const botHeight = 2.0;
  const botBox = new THREE.Box3(
    new THREE.Vector3(nextPos.x - botRadius, nextPos.y - botHeight * 0.5, nextPos.z - botRadius),
    new THREE.Vector3(nextPos.x + botRadius, nextPos.y + botHeight * 0.5, nextPos.z + botRadius)
  );

  for (const obs of obstacles) {
    const obsBox = new THREE.Box3().setFromObject(obs);
    if (obsBox.intersectsBox(botBox)) {
      blocked = true;
      break;
    }
  }

  if (!blocked) {
    botPos.copy(nextPos);
  }

  // Make bot face the player
  bot.lookAt(target.x, bot.position.y, target.z);

  // Small bobbing for creepiness
  bot.position.y = 1 + Math.sin(performance.now() * 0.004) * 0.1;
}

function setupTouchControls() {
  const joystick = document.getElementById("joystick");
  const joystickThumb = document.getElementById("joystick-thumb");
  if (!joystick || !joystickThumb) return;

  joystick.style.display = "flex";

  const handleMove = (x, y) => {
    const rect = joystick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const maxDist = rect.width / 2;
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), maxDist);
    const nx = (dist === 0 ? 0 : dx / dist) * (dist / maxDist);
    const ny = (dist === 0 ? 0 : dy / dist) * (dist / maxDist);

    joystickDir.x = nx;
    joystickDir.y = ny;

    joystickThumb.style.transform = `translate(${nx * maxDist * 0.6}px, ${ny * maxDist * 0.6}px)`;

    const dead = 0.2;
    moveForward = ny < -dead;
    moveBackward = ny > dead;
    moveLeft = nx < -dead;
    moveRight = nx > dead;
  };

  const clearMove = () => {
    joystickDir.x = 0;
    joystickDir.y = 0;
    moveForward = moveBackward = moveLeft = moveRight = false;
    joystickThumb.style.transform = "translate(0px, 0px)";
  };

  joystick.addEventListener("touchstart", (e) => {
    joystickActive = true;
    const t = e.touches[0];
    handleMove(t.clientX, t.clientY);
  });

  joystick.addEventListener("touchmove", (e) => {
    if (!joystickActive) return;
    const t = e.touches[0];
    handleMove(t.clientX, t.clientY);
  });

  joystick.addEventListener("touchend", () => {
    joystickActive = false;
    clearMove();
  });

  // Simple swipe look on the right half of the screen
  let lookTouchId = null;
  let lastX = 0;
  let lastY = 0;
  const sensitivity = 0.004;

  const onTouchStart = (e) => {
    for (const t of e.changedTouches) {
      if (t.clientX > window.innerWidth / 2 && lookTouchId === null) {
        lookTouchId = t.identifier;
        lastX = t.clientX;
        lastY = t.clientY;
      }
    }
  };

  const onTouchMove = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === lookTouchId) {
        const dx = t.clientX - lastX;
        const dy = t.clientY - lastY;
        lastX = t.clientX;
        lastY = t.clientY;

        yaw -= dx * sensitivity;
        pitch -= dy * sensitivity;
        const maxPitch = (Math.PI / 180) * 75;
        pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
        camera.rotation.set(pitch, yaw, 0, "YXZ");
      }
    }
  };

  const onTouchEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === lookTouchId) {
        lookTouchId = null;
      }
    }
  };

  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchmove", onTouchMove, { passive: true });
  document.addEventListener("touchend", onTouchEnd, { passive: true });
}

