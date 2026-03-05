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
let botStuckFrames = 0;

// Weapons / combat
let pepperCooldown = 0;
let gunCooldown = 0;
const PEPPER_COOLDOWN_TIME = 12; // seconds
const GUN_COOLDOWN_TIME = 12; // seconds
const PEPPER_RANGE = 6;
const GUN_RANGE = 25;
const PEPPER_STUN_TIME = 2.5;
const GUN_STUN_TIME = 4;
let botStunTimer = 0;
let botVelocity = new THREE.Vector3();

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
const pepperCooldownLabel = document.getElementById("pepperCooldownLabel");
const gunCooldownLabel = document.getElementById("gunCooldownLabel");
const weaponsHudEl = document.getElementById("weaponsHud");
const pepperButtonEl = document.getElementById("pepperButton");
const gunButtonEl = document.getElementById("gunButton");

// Put your face image at ./assets/face.png and sounds in ./assets/
const ASSETS = {
  faceTexture: "./assets/face.png",
  chaseSound: "./assets/chase.mp3",
  endSound: "./assets/end.mp3",
  kissSound: "./assets/kiss-sfx.mp3",
  spraySound: "./assets/spray.mp3",
  gunSound: "./assets/gunshot.mp3",
  screamSound: "./assets/scream.mp3",
};

let audioListener, chaseSound, endSound, kissSound, spraySound, gunSound, screamSound;

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
  spraySound = new THREE.Audio(audioListener);
  gunSound = new THREE.Audio(audioListener);
  screamSound = new THREE.Audio(audioListener);

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

  audioLoader.load(
    ASSETS.spraySound,
    (buffer) => {
      spraySound.setBuffer(buffer);
      spraySound.setLoop(false);
      spraySound.setVolume(0.9);
    },
    undefined,
    () => {
      console.warn("Spray sound not found, skipping audio.");
    }
  );

  audioLoader.load(
    ASSETS.gunSound,
    (buffer) => {
      gunSound.setBuffer(buffer);
      gunSound.setLoop(false);
      gunSound.setVolume(1.0);
    },
    undefined,
    () => {
      console.warn("Gun sound not found, skipping audio.");
    }
  );

  audioLoader.load(
    ASSETS.screamSound,
    (buffer) => {
      screamSound.setBuffer(buffer);
      screamSound.setLoop(false);
      screamSound.setVolume(0.9);
    },
    undefined,
    () => {
      console.warn("Scream sound not found, skipping audio.");
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
      case "KeyQ":
        triggerPepperSpray();
        break;
      case "KeyE":
        triggerGun();
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

    // Show mobile weapon buttons and hook them up
    const mobileWeapons = document.getElementById("mobileWeapons");
    if (mobileWeapons) {
      mobileWeapons.style.display = "flex";
    }
    // Hide numeric cooldown HUD on mobile; we use fill-based buttons instead.
    if (weaponsHudEl) {
      weaponsHudEl.style.display = "none";
    }
    if (pepperButtonEl) {
      const firePepper = (e) => {
        e.preventDefault();
        triggerPepperSpray();
      };
      pepperButtonEl.addEventListener("touchstart", firePepper, { passive: false });
      pepperButtonEl.addEventListener("click", firePepper);
    }
    if (gunButtonEl) {
      const fireGun = (e) => {
        e.preventDefault();
        triggerGun();
      };
      gunButtonEl.addEventListener("touchstart", fireGun, { passive: false });
      gunButtonEl.addEventListener("click", fireGun);
    }
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

  // Reset combat state
  pepperCooldown = 0;
  gunCooldown = 0;
  botStunTimer = 0;
  botVelocity.set(0, 0, 0);
  updateWeaponHud();

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
    // Tick cooldowns and stun
    if (pepperCooldown > 0) pepperCooldown = Math.max(0, pepperCooldown - delta);
    if (gunCooldown > 0) gunCooldown = Math.max(0, gunCooldown - delta);
    if (botStunTimer > 0) botStunTimer = Math.max(0, botStunTimer - delta);
    updateWeaponHud();

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

  // If stunned, just apply lingering knockback velocity and skip chasing
  if (botStunTimer > 0) {
    if (botVelocity.lengthSq() > 0.0001) {
      const nextPos = new THREE.Vector3().copy(botPos).addScaledVector(botVelocity, delta);

      const botRadius = 1.1;
      const botHeight = 2.0;
      const botBox = new THREE.Box3(
        new THREE.Vector3(
          nextPos.x - botRadius,
          nextPos.y - botHeight * 0.5,
          nextPos.z - botRadius
        ),
        new THREE.Vector3(
          nextPos.x + botRadius,
          nextPos.y + botHeight * 0.5,
          nextPos.z + botRadius
        )
      );

      let blocked = false;
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

      // simple damping so it slows down
      botVelocity.multiplyScalar(0.9);
    }

    // Bot still faces player even while stunned
    bot.lookAt(target.x, bot.position.y, target.z);
    bot.position.y = 1 + Math.sin(performance.now() * 0.004) * 0.1;
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

  const currentSpeed = botSpeed + elapsedSurvival * 0.15;
  const baseDir = toPlayer.normalize();

  // Try moving directly toward the player; if blocked, try wider offset angles around them
  const tryDirections = [0, 0.9, -0.9, 1.6, -1.6]; // radians (~0°, ±50°, ±90°)
  const botRadius = 1.1;
  const botHeight = 2.0;
  let moved = false;

  for (let i = 0; i < tryDirections.length && !moved; i++) {
    const angle = tryDirections[i];

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dir = new THREE.Vector3(
      baseDir.x * cos - baseDir.z * sin,
      0,
      baseDir.x * sin + baseDir.z * cos
    ).normalize();

    const moveStep = new THREE.Vector3().copy(dir).multiplyScalar(currentSpeed * delta);
    const nextPos = new THREE.Vector3().copy(botPos).add(moveStep);

    const botBox = new THREE.Box3(
      new THREE.Vector3(
        nextPos.x - botRadius,
        nextPos.y - botHeight * 0.5,
        nextPos.z - botRadius
      ),
      new THREE.Vector3(
        nextPos.x + botRadius,
        nextPos.y + botHeight * 0.5,
        nextPos.z + botRadius
      )
    );

    let blocked = false;
    for (const obs of obstacles) {
      const obsBox = new THREE.Box3().setFromObject(obs);
      if (obsBox.intersectsBox(botBox)) {
        blocked = true;
        break;
      }
    }

    if (!blocked) {
      botPos.copy(nextPos);
      moved = true;
    }
  }

  // If we couldn't move for several frames, nudge the bot out from obstacles
  if (!moved) {
    botStuckFrames++;
    if (botStuckFrames > 20) {
      let closestObs = null;
      let closestDistSq = Infinity;
      const botXZ = new THREE.Vector2(botPos.x, botPos.z);

      for (const obs of obstacles) {
        const p = obs.position;
        const obsXZ = new THREE.Vector2(p.x, p.z);
        const dSq = botXZ.distanceToSquared(obsXZ);
        if (dSq < closestDistSq) {
          closestDistSq = dSq;
          closestObs = obs;
        }
      }

      if (closestObs) {
        const awayDir = new THREE.Vector3().subVectors(botPos, closestObs.position);
        awayDir.y = 0;
        if (awayDir.lengthSq() > 0.0001) {
          awayDir.normalize();
          // Pop farther away from obstacle, ignoring collisions for this tiny nudge
          const unstuckDistance = 1.0;
          botPos.addScaledVector(awayDir, unstuckDistance);
        }
      }

      botStuckFrames = 0;
    }
  } else {
    botStuckFrames = 0;
  }

  // Add any residual knockback velocity when not stunned (very small effect)
  if (botVelocity.lengthSq() > 0.0001) {
    const nextPos = new THREE.Vector3().copy(botPos).addScaledVector(botVelocity, delta);

    const botRadius = 1.1;
    const botHeight = 2.0;
    const botBox = new THREE.Box3(
      new THREE.Vector3(
        nextPos.x - botRadius,
        nextPos.y - botHeight * 0.5,
        nextPos.z - botRadius
      ),
      new THREE.Vector3(
        nextPos.x + botRadius,
        nextPos.y + botHeight * 0.5,
        nextPos.z + botRadius
      )
    );

    let blocked = false;
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

    botVelocity.multiplyScalar(0.9);
  }

  // Make bot face the player
  bot.lookAt(target.x, bot.position.y, target.z);

  // Small bobbing for creepiness
  bot.position.y = 1 + Math.sin(performance.now() * 0.004) * 0.1;
}

function triggerPepperSpray() {
  if (!bot || gameOver || !started) return;
  if (pepperCooldown > 0) return;

  const toBot = new THREE.Vector3().subVectors(bot.position, camera.position);
  const distance = toBot.length();

  // Always consume the spray and show the effect, even if it misses
  pepperCooldown = PEPPER_COOLDOWN_TIME;
  spawnPepperSprayEffect(Math.min(distance, PEPPER_RANGE));

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();

  toBot.y = 0;
  toBot.normalize();

  const dot = forward.dot(toBot);
  const inRange = distance <= PEPPER_RANGE;
  const inCone = dot >= Math.cos((45 * Math.PI) / 180);

  // If out of range or not in front, the spray is "wasted" – no effect on bot.
  if (!inRange || !inCone) {
    // Still play spray SFX when firing, even on a miss
    if (spraySound && spraySound.buffer) {
      if (spraySound.isPlaying) {
        spraySound.stop();
      }
      // Skip the first 0.2s of the clip
      spraySound.offset = 0.2;
      spraySound.play();
    }
    return;
  }

  // Apply knockback away from player and stun
  const knockDir = new THREE.Vector3().subVectors(bot.position, camera.position);
  knockDir.y = 0;
  if (knockDir.lengthSq() > 0.0001) {
    knockDir.normalize();
    botVelocity.copy(knockDir).multiplyScalar(12);
  }

  botStunTimer = PEPPER_STUN_TIME;

  spawnBotHitEffect(false);

  // Play spray SFX, skipping the first 0.2s of the clip
  if (spraySound && spraySound.buffer) {
    if (spraySound.isPlaying) {
      spraySound.stop();
    }
    spraySound.offset = 0.2;
    spraySound.play();
  }

  // Visual already spawned above in trigger call
}

function triggerGun() {
  if (!bot || gameOver || !started) return;
  if (gunCooldown > 0) return;

  const toBot = new THREE.Vector3().subVectors(bot.position, camera.position);
  const distance = toBot.length();
  if (distance > GUN_RANGE) return;

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();

  toBot.y = 0;
  toBot.normalize();

  const dot = forward.dot(toBot);
  if (dot < Math.cos((30 * Math.PI) / 180)) {
    // not tightly in front (narrower cone than pepper spray)
    return;
  }

  // Stronger knockback and longer stun
  const knockDir = new THREE.Vector3().subVectors(bot.position, camera.position);
  knockDir.y = 0;
  if (knockDir.lengthSq() > 0.0001) {
    knockDir.normalize();
    botVelocity.copy(knockDir).multiplyScalar(24);
  }

  botStunTimer = GUN_STUN_TIME;
  gunCooldown = GUN_COOLDOWN_TIME;

  spawnGunMuzzleFlash();
  // Fast visual bullet traveling to the bot's position at the moment of the shot
  spawnGunBulletEffect(bot.position.clone());

  spawnBotHitEffect(true);

  // Play gunshot SFX
  if (gunSound && gunSound.buffer) {
    if (gunSound.isPlaying) {
      gunSound.stop();
    }
    gunSound.play();
  }
}

function updateWeaponHud() {
  if (pepperCooldownLabel) {
    pepperCooldownLabel.textContent =
      pepperCooldown > 0 ? `${pepperCooldown.toFixed(1)}s` : "Ready";
  }
  if (gunCooldownLabel) {
    gunCooldownLabel.textContent = gunCooldown > 0 ? `${gunCooldown.toFixed(1)}s` : "Ready";
  }

   updateMobileWeaponButtons();
}

function updateMobileWeaponButtons() {
  if (!isTouchDevice) return;

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  if (pepperButtonEl) {
    const ratio =
      PEPPER_COOLDOWN_TIME > 0 ? 1 - pepperCooldown / PEPPER_COOLDOWN_TIME : 1;
    const fill = clamp01(ratio);
    pepperButtonEl.style.setProperty("--fill", fill.toString());
    pepperButtonEl.disabled = pepperCooldown > 0;
  }

  if (gunButtonEl) {
    const ratio = GUN_COOLDOWN_TIME > 0 ? 1 - gunCooldown / GUN_COOLDOWN_TIME : 1;
    const fill = clamp01(ratio);
    gunButtonEl.style.setProperty("--fill", fill.toString());
    gunButtonEl.disabled = gunCooldown > 0;
  }
}

function spawnPepperSprayEffect(distanceToBot) {
  if (!scene || !camera) return;

  const origin = new THREE.Vector3().copy(camera.position);
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.normalize();

  const right = new THREE.Vector3().copy(forward).cross(new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3(0, 1, 0);

  const maxLen = Math.min(distanceToBot || PEPPER_RANGE, PEPPER_RANGE);
  const count = 14;

  for (let i = 0; i < count; i++) {
    const particleGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const particleMat = new THREE.MeshBasicMaterial({
      color: 0xffe28a,
      transparent: true,
      opacity: 0.9,
    });
    const p = new THREE.Mesh(particleGeo, particleMat);

    const offsetRight = (Math.random() - 0.5) * 0.35;
    const offsetUp = (Math.random() - 0.3) * 0.25;
    const startPos = new THREE.Vector3()
      .copy(origin)
      .addScaledVector(forward, 0.5)
      .addScaledVector(right, offsetRight)
      .addScaledVector(up, offsetUp);

    const travel = maxLen * (0.6 + Math.random() * 0.4);
    const endPos = new THREE.Vector3().copy(origin).addScaledVector(forward, travel);

    p.position.copy(startPos);
    scene.add(p);

    const lifetime = 220 + Math.random() * 80; // ms
    const start = performance.now();

    const tick = () => {
      const now = performance.now();
      const t = (now - start) / lifetime;
      if (t >= 1) {
        scene.remove(p);
        particleGeo.dispose();
        particleMat.dispose();
        return;
      }
      p.position.lerpVectors(startPos, endPos, t);
      particleMat.opacity = 0.9 * (1 - t);
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }
}

function spawnGunMuzzleFlash() {
  if (!scene || !camera) return;

  const flashGeo = new THREE.SphereGeometry(0.22, 12, 12);
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xfff6c0,
    transparent: true,
    opacity: 1.0,
  });
  const flash = new THREE.Mesh(flashGeo, flashMat);

  const origin = new THREE.Vector3().copy(camera.position);
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.normalize();

  origin.addScaledVector(forward, 0.8);
  flash.position.copy(origin);

  scene.add(flash);

  const lifetime = 90; // ms
  const start = performance.now();

  const tick = () => {
    const now = performance.now();
    const t = (now - start) / lifetime;
    if (t >= 1) {
      scene.remove(flash);
      flashGeo.dispose();
      flashMat.dispose();
      return;
    }
    flashMat.opacity = 1.0 * (1 - t);
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

function spawnGunBulletEffect(hitPosition) {
  if (!scene || !camera) return;

  const bulletGeo = new THREE.SphereGeometry(0.08, 10, 10);
  const bulletMat = new THREE.MeshBasicMaterial({
    color: 0xfff6c0,
    emissive: 0xfff6c0,
    emissiveIntensity: 0.6,
  });
  const bullet = new THREE.Mesh(bulletGeo, bulletMat);

  const startPos = new THREE.Vector3().copy(camera.position);
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.normalize();
  startPos.addScaledVector(forward, 0.6);

  const endPos = hitPosition
    ? hitPosition.clone()
    : new THREE.Vector3().copy(startPos).addScaledVector(forward, GUN_RANGE * 0.8);

  bullet.position.copy(startPos);
  scene.add(bullet);

  const lifetime = 160; // ms
  const start = performance.now();

  const tick = () => {
    const now = performance.now();
    const t = (now - start) / lifetime;
    if (t >= 1) {
      scene.remove(bullet);
      bulletGeo.dispose();
      bulletMat.dispose();
      return;
    }
    bullet.position.lerpVectors(startPos, endPos, t);
    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

function spawnBotHitEffect(isGun) {
  if (!scene || !bot) return;

  // Blood splash particles
  const count = isGun ? 22 : 16;
  const baseColor = 0x991111;
  const radius = isGun ? 0.6 : 0.45;

  for (let i = 0; i < count; i++) {
    const geo = new THREE.SphereGeometry(isGun ? 0.09 : 0.07, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: baseColor,
      transparent: true,
      opacity: 0.9,
    });
    const p = new THREE.Mesh(geo, mat);

    const angle = Math.random() * Math.PI * 2;
    const up = Math.random() * 0.4 + 0.1;
    const r = radius * (0.4 + Math.random() * 0.8);
    const offset = new THREE.Vector3(
      Math.cos(angle) * r,
      up,
      Math.sin(angle) * r
    );

    const startPos = new THREE.Vector3().copy(bot.position).add(offset);
    const endPos = new THREE.Vector3()
      .copy(startPos)
      .add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.3) * 0.3,
          (Math.random() - 0.5) * 0.4
        )
      );

    p.position.copy(startPos);
    scene.add(p);

    const lifetime = isGun ? 280 : 240;
    const start = performance.now();

    const tick = () => {
      const now = performance.now();
      const t = (now - start) / lifetime;
      if (t >= 1) {
        scene.remove(p);
        geo.dispose();
        mat.dispose();
        return;
      }
      p.position.lerpVectors(startPos, endPos, t);
      mat.opacity = 0.9 * (1 - t);
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }

  // Play scream SFX when the bot is hit (gun or spray)
  if (screamSound && screamSound.buffer) {
    if (screamSound.isPlaying) {
      screamSound.stop();
    }
    screamSound.play();
  }
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

