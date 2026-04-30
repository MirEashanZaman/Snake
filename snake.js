const COLS = 20;
const ROWS = 20;
const CELL = 16;

const COLORS = {
    body: "#0f380f",
    bodyDark: "#1d4a1d",
    head: "#0a280a",
    food: "#0f380f",
    bigFood: "#0f380f",
    wall: "#0a280a",
};

const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
};

const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

const LEVELS = {
    easy: {
        name: "EASY",
        baseTick: 210,
        minTick: 150,
        speedStep: 2,
        walls: () => [],
    },
    normal: {
        name: "NORMAL",
        baseTick: 130,
        minTick: 75,
        speedStep: 6,
        walls: () => [],
    },
    hard: {
        name: "HARD",
        baseTick: 100,
        minTick: 60,
        speedStep: 6,
        walls: () => buildBorderWalls(),
    },
    insane: {
        name: "INSANE",
        baseTick: 75,
        minTick: 45,
        speedStep: 7,
        walls: () => buildMazeWalls(),
    },
};

const SCORE_PER_FOOD = 10;
const BIG_EGG_EVERY = 5;
const BIG_EGG_LIFETIME_MS = 6000;
const BIG_EGG_SCORE = 50;

const $ = (id) => document.getElementById(id);

const canvas = $("board");
const ctx = canvas.getContext("2d");
canvas.width = COLS * CELL;
canvas.height = ROWS * CELL;

const scoreEl = $("score");
const bestEl = $("best");
const speedEl = $("speed");
const statusEl = $("status");
const levelNameEl = $("levelName");
const overlay = $("overlay");
const pauseBtn = $("pauseBtn");
const soundBtn = $("soundBtn");
const soundIcon = $("soundIcon");

const BEST_KEY_PREFIX = "snake.best.";
const SOUND_KEY = "snake.sound";
const LEVEL_KEY = "snake.level";

const sound = {
    enabled: localStorage.getItem(SOUND_KEY) !== "off",
    ctx: null,
    ensure() {
        if (!this.enabled) return null;
        if (!this.ctx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return null;
            this.ctx = new Ctx();
        }
        if (this.ctx.state === "suspended") {
            this.ctx.resume().catch(() => { });
        }
        return this.ctx;
    },
    beep({ freq = 660, duration = 0.06, type = "square", volume = 0.06, slide }) {
        const ac = this.ensure();
        if (!ac) return;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        if (slide) {
            osc.frequency.exponentialRampToValueAtTime(
                Math.max(50, slide),
                ac.currentTime + duration,
            );
        }
        gain.gain.value = volume;
        gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
        osc.connect(gain).connect(ac.destination);
        osc.start();
        osc.stop(ac.currentTime + duration);
    },
    eat() {
        this.beep({ freq: 880, duration: 0.07, type: "square", volume: 0.07 });
    },
    bigEat() {
        this.beep({ freq: 660, duration: 0.08, type: "square", volume: 0.08 });
        setTimeout(() => this.beep({ freq: 990, duration: 0.1, type: "square", volume: 0.08 }), 70);
        setTimeout(() => this.beep({ freq: 1320, duration: 0.14, type: "square", volume: 0.08 }), 170);
    },
    bigSpawn() {
        this.beep({ freq: 1480, duration: 0.05, type: "triangle", volume: 0.05 });
        setTimeout(() => this.beep({ freq: 1760, duration: 0.05, type: "triangle", volume: 0.05 }), 60);
    },
    turn() {
        this.beep({ freq: 320, duration: 0.025, type: "square", volume: 0.025 });
    },
    pause() {
        this.beep({ freq: 440, duration: 0.05, type: "square", volume: 0.05 });
    },
    over() {
        this.beep({
            freq: 440,
            duration: 0.4,
            type: "sawtooth",
            volume: 0.08,
            slide: 80,
        });
    },
    click() {
        this.beep({ freq: 540, duration: 0.03, type: "square", volume: 0.04 });
    },
    toggle() {
        this.enabled = !this.enabled;
        localStorage.setItem(SOUND_KEY, this.enabled ? "on" : "off");
        if (this.enabled) this.click();
        updateSoundUi();
    },
};

function updateSoundUi() {
    soundIcon.textContent = sound.enabled ? "♪ ON" : "♪ OFF";
    soundBtn.dataset.on = String(sound.enabled);
}

function buildBorderWalls() {
    return [
        { x: 6, y: 6 },
        { x: 7, y: 6 },
        { x: 13, y: 6 },
        { x: 12, y: 6 },
        { x: 6, y: 13 },
        { x: 7, y: 13 },
        { x: 12, y: 13 },
        { x: 13, y: 13 },
    ];
}

function buildMazeWalls() {
    const walls = [];
    walls.push({ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 4, y: 5 });
    walls.push({ x: 14, y: 4 }, { x: 15, y: 4 }, { x: 15, y: 5 });
    walls.push({ x: 4, y: 15 }, { x: 4, y: 14 }, { x: 5, y: 15 });
    walls.push({ x: 15, y: 15 }, { x: 14, y: 15 }, { x: 15, y: 14 });
    walls.push({ x: 9, y: 7 }, { x: 10, y: 7 }, { x: 9, y: 8 }, { x: 10, y: 8 });
    walls.push({ x: 9, y: 12 }, { x: 10, y: 12 }, { x: 9, y: 13 }, { x: 10, y: 13 });
    return walls;
}

const state = {
    level: localStorage.getItem(LEVEL_KEY) || "easy",
    snake: [],
    walls: [],
    dir: "right",
    nextDir: "right",
    food: { x: 0, y: 0 },
    bigFood: null,
    eatenSinceBig: 0,
    score: 0,
    best: 0,
    status: "menu",
    tickMs: LEVELS.easy.baseTick,
    lastTick: 0,
    rafId: 0,
};

const bestKey = () => `${BEST_KEY_PREFIX}${state.level}`;
const loadBest = () => {
    state.best = Number(localStorage.getItem(bestKey()) || 0);
};

const randCell = () => ({
    x: Math.floor(Math.random() * COLS),
    y: Math.floor(Math.random() * ROWS),
});

function isOccupied(p) {
    if (state.snake.some((s) => s.x === p.x && s.y === p.y)) return true;
    if (state.walls.some((w) => w.x === p.x && w.y === p.y)) return true;
    if (state.food && state.food.x === p.x && state.food.y === p.y) return true;
    if (
        state.bigFood &&
        p.x >= state.bigFood.x &&
        p.x <= state.bigFood.x + 1 &&
        p.y >= state.bigFood.y &&
        p.y <= state.bigFood.y + 1
    ) {
        return true;
    }
    return false;
}

function placeFood() {
    let attempt;
    let tries = 0;
    do {
        attempt = randCell();
        tries++;
        if (tries > 500) break;
    } while (isOccupied(attempt));
    state.food = attempt;
}

function placeBigFood() {
    let tries = 0;
    while (tries < 500) {
        tries++;
        const p = {
            x: Math.floor(Math.random() * (COLS - 1)),
            y: Math.floor(Math.random() * (ROWS - 1)),
        };
        let ok = true;
        for (let dx = 0; dx < 2 && ok; dx++) {
            for (let dy = 0; dy < 2 && ok; dy++) {
                if (isOccupied({ x: p.x + dx, y: p.y + dy })) ok = false;
            }
        }
        if (ok) {
            state.bigFood = {
                x: p.x,
                y: p.y,
                expiresAt: performance.now() + BIG_EGG_LIFETIME_MS,
            };
            sound.bigSpawn();
            return;
        }
    }
}

function reset() {
    const cfg = LEVELS[state.level];
    state.walls = cfg.walls();
    state.dir = "right";
    state.nextDir = "right";
    state.score = 0;
    state.tickMs = cfg.baseTick;
    state.bigFood = null;
    state.eatenSinceBig = 0;

    const wallSet = new Set(state.walls.map((w) => `${w.x},${w.y}`));
    const candidates = [
        Math.floor(ROWS / 2),
        Math.floor(ROWS / 2) - 1,
        Math.floor(ROWS / 2) + 1,
        1,
        ROWS - 2,
    ];
    let spawnY = candidates[0];
    for (const y of candidates) {
        let ok = true;
        for (let x = 0; x < 7; x++) {
            if (wallSet.has(`${x},${y}`)) {
                ok = false;
                break;
            }
        }
        if (ok) {
            spawnY = y;
            break;
        }
    }
    state.snake = [
        { x: 5, y: spawnY },
        { x: 4, y: spawnY },
        { x: 3, y: spawnY },
    ];

    loadBest();
    placeFood();
    updateHud();
    draw();
}

function updateHud() {
    const cfg = LEVELS[state.level];
    scoreEl.textContent = String(state.score);
    bestEl.textContent = String(state.best);
    levelNameEl.textContent = cfg.name;
    const level = Math.max(
        1,
        Math.floor((cfg.baseTick - state.tickMs) / cfg.speedStep) + 1,
    );
    speedEl.textContent = String(level);
}

function setStatus(label) {
    statusEl.textContent = label;
}

function clearOverlay() {
    overlay.innerHTML = "";
    overlay.classList.add("hidden");
}

function setOverlayContent(html) {
    overlay.innerHTML = html;
    overlay.classList.remove("hidden");
}

function renderMenu() {
    const levels = Object.entries(LEVELS)
        .map(
            ([key, cfg]) => `
<button class="level-btn" data-level="${key}" data-selected="${key === state.level}">
${cfg.name}
</button>
`,
        )
        .join("");
    setOverlayContent(`
<div class="overlay__panel">
<h1 class="overlay__title">SNAKE</h1>
<p class="overlay__subtitle">SELECT LEVEL</p>
<div class="level-grid">${levels}</div>
<div class="menu-actions">
<button class="overlay__btn" id="startBtn">START</button>
</div>
<p class="overlay__hint" style="margin-top:12px;margin-bottom:0">
RETURN TO NOSTALGIA
</p>
</div>
`);
    overlay.querySelectorAll(".level-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            sound.click();
            state.level = btn.dataset.level;
            localStorage.setItem(LEVEL_KEY, state.level);
            overlay
                .querySelectorAll(".level-btn")
                .forEach((b) => (b.dataset.selected = String(b === btn)));
            reset();
        });
    });
    const startBtn = overlay.querySelector("#startBtn");
    if (startBtn) {
        startBtn.addEventListener("click", () => {
            sound.click();
            start();
        });
    }
}

function renderPause() {
    setOverlayContent(`
<div class="overlay__panel">
<h1 class="overlay__title">PAUSED</h1>
<p class="overlay__subtitle">${LEVELS[state.level].name} · SCORE ${state.score}</p>
<div class="menu-actions">
<button class="overlay__btn" id="resumeBtn">RESUME</button>
<button class="overlay__btn overlay__btn--secondary" id="restartBtn">RESTART</button>
<button class="overlay__btn overlay__btn--secondary" id="menuBtn">MAIN MENU</button>
</div>
</div>
`);
    overlay.querySelector("#resumeBtn").addEventListener("click", () => {
        sound.click();
        resume();
    });
    overlay.querySelector("#restartBtn").addEventListener("click", () => {
        sound.click();
        restartCurrentLevel();
    });
    overlay.querySelector("#menuBtn").addEventListener("click", () => {
        sound.click();
        goToMenu();
    });
}

function renderGameOver() {
    setOverlayContent(`
<div class="overlay__panel">
<h1 class="overlay__title">GAME OVER</h1>
<p class="overlay__subtitle">${LEVELS[state.level].name}</p>
<div class="score-row">
<div>SCORE<strong>${state.score}</strong></div>
<div>BEST<strong>${state.best}</strong></div>
</div>
<div class="menu-actions">
<button class="overlay__btn" id="againBtn">PLAY AGAIN</button>
<button class="overlay__btn overlay__btn--secondary" id="menuBtn">MAIN MENU</button>
</div>
</div>
`);
    overlay.querySelector("#againBtn").addEventListener("click", () => {
        sound.click();
        restartCurrentLevel();
        start();
    });
    overlay.querySelector("#menuBtn").addEventListener("click", () => {
        sound.click();
        goToMenu();
    });
}

function start() {
    if (state.status === "running") return;
    if (state.status === "menu" || state.status === "over") {
        reset();
    }
    state.status = "running";
    state.lastTick = performance.now();
    if (state.bigFood) {
        state.bigFood.expiresAt = performance.now() + BIG_EGG_LIFETIME_MS;
    }
    setStatus("PLAY");
    clearOverlay();
    loop(state.lastTick);
}

function pause() {
    if (state.status !== "running") return;
    state.status = "paused";
    cancelAnimationFrame(state.rafId);
    setStatus("PAUSE");
    sound.pause();
    renderPause();
}

function resume() {
    if (state.status !== "paused") return;
    state.status = "running";
    state.lastTick = performance.now();
    if (state.bigFood && state.bigFood.expiresAt < performance.now()) {
        state.bigFood = null;
    }
    setStatus("PLAY");
    clearOverlay();
    loop(state.lastTick);
}

function restartCurrentLevel() {
    cancelAnimationFrame(state.rafId);
    state.status = "menu";
    reset();
    start();
}

function goToMenu() {
    cancelAnimationFrame(state.rafId);
    state.status = "menu";
    reset();
    setStatus("READY");
    renderMenu();
}

function gameOver() {
    state.status = "over";
    cancelAnimationFrame(state.rafId);
    if (state.score > state.best) {
        state.best = state.score;
        localStorage.setItem(bestKey(), String(state.best));
    }
    updateHud();
    setStatus("OVER");
    sound.over();
    flashBoard();
    setTimeout(() => renderGameOver(), 350);
}

function flashBoard() {
    let flips = 0;
    const id = setInterval(() => {
        canvas.style.filter = flips % 2 === 0 ? "invert(1)" : "none";
        flips += 1;
        if (flips >= 4) {
            clearInterval(id);
            canvas.style.filter = "none";
        }
    }, 90);
}

function step() {
    if (OPPOSITE[state.nextDir] !== state.dir) {
        state.dir = state.nextDir;
    }

    const head = state.snake[0];
    const delta = DIRS[state.dir];
    const newHead = { x: head.x + delta.x, y: head.y + delta.y };

    if (
        newHead.x < 0 ||
        newHead.x >= COLS ||
        newHead.y < 0 ||
        newHead.y >= ROWS
    ) {
        gameOver();
        return;
    }

    if (state.walls.some((w) => w.x === newHead.x && w.y === newHead.y)) {
        gameOver();
        return;
    }

    const willEatNormal =
        newHead.x === state.food.x && newHead.y === state.food.y;
    const willEatBig =
        state.bigFood &&
        newHead.x >= state.bigFood.x &&
        newHead.x <= state.bigFood.x + 1 &&
        newHead.y >= state.bigFood.y &&
        newHead.y <= state.bigFood.y + 1;

    const willGrow = willEatNormal || willEatBig;

    const bodyToCheck = willGrow ? state.snake : state.snake.slice(0, -1);
    for (const seg of bodyToCheck) {
        if (seg.x === newHead.x && seg.y === newHead.y) {
            gameOver();
            return;
        }
    }

    state.snake.unshift(newHead);

    if (willEatBig) {
        state.score += BIG_EGG_SCORE;
        state.bigFood = null;
        state.eatenSinceBig = 0;
        sound.bigEat();
        bumpSpeed();
        bumpSpeed();
        updateHud();
    } else if (willEatNormal) {
        state.score += SCORE_PER_FOOD;
        state.eatenSinceBig += 1;
        placeFood();
        sound.eat();
        bumpSpeed();
        if (state.eatenSinceBig >= BIG_EGG_EVERY && !state.bigFood) {
            placeBigFood();
            state.eatenSinceBig = 0;
        }
        updateHud();
    } else {
        state.snake.pop();
    }

    if (state.bigFood && performance.now() > state.bigFood.expiresAt) {
        state.bigFood = null;
    }
}

function bumpSpeed() {
    const cfg = LEVELS[state.level];
    if (state.tickMs > cfg.minTick) {
        state.tickMs = Math.max(cfg.minTick, state.tickMs - cfg.speedStep);
    }
}

function loop(now) {
    if (state.status !== "running") return;
    state.rafId = requestAnimationFrame(loop);

    if (now - state.lastTick >= state.tickMs) {
        state.lastTick = now;
        step();
        draw();
    } else if (state.bigFood) {
        draw();
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const w of state.walls) {
        ctx.fillStyle = COLORS.wall;
        ctx.fillRect(w.x * CELL + 1, w.y * CELL + 1, CELL - 2, CELL - 2);
        ctx.fillStyle = "rgba(155, 188, 15, 0.25)";
        ctx.fillRect(w.x * CELL + 4, w.y * CELL + 4, CELL - 8, CELL - 8);
    }

    if (state.bigFood) {
        const remaining = Math.max(0, state.bigFood.expiresAt - performance.now());
        const blinkPeriod = remaining < 1500 ? 140 : remaining < 3000 ? 260 : 480;
        const visible =
            Math.floor(performance.now() / blinkPeriod) % 2 === 0 ||
            remaining > 4500;
        if (visible) {
            ctx.fillStyle = COLORS.bigFood;
            ctx.fillRect(
                state.bigFood.x * CELL + 2,
                state.bigFood.y * CELL + 2,
                CELL * 2 - 4,
                CELL * 2 - 4,
            );
            ctx.fillStyle = "rgba(155, 188, 15, 0.85)";
            ctx.fillRect(
                state.bigFood.x * CELL + CELL - 2,
                state.bigFood.y * CELL + CELL - 2,
                4,
                4,
            );
            ctx.fillRect(state.bigFood.x * CELL + 5, state.bigFood.y * CELL + 5, 2, 2);
            ctx.fillRect(
                state.bigFood.x * CELL + CELL * 2 - 7,
                state.bigFood.y * CELL + CELL * 2 - 7,
                2,
                2,
            );
        }
    }

    drawCell(state.food.x, state.food.y, COLORS.food);
    ctx.fillStyle = "rgba(155, 188, 15, 0.7)";
    ctx.fillRect(
        state.food.x * CELL + CELL / 2 - 1,
        state.food.y * CELL + CELL / 2 - 1,
        2,
        2,
    );

    for (let i = state.snake.length - 1; i >= 0; i--) {
        const seg = state.snake[i];
        const isHead = i === 0;
        drawCell(seg.x, seg.y, isHead ? COLORS.head : COLORS.body);
        if (!isHead) {
            ctx.fillStyle = COLORS.bodyDark;
            ctx.fillRect(seg.x * CELL + 4, seg.y * CELL + 4, CELL - 8, CELL - 8);
        }
    }
    drawHeadEye();
}

function drawCell(cx, cy, color) {
    ctx.fillStyle = color;
    ctx.fillRect(cx * CELL + 1, cy * CELL + 1, CELL - 2, CELL - 2);
}

function drawHeadEye() {
    const head = state.snake[0];
    if (!head) return;
    const cx = head.x * CELL;
    const cy = head.y * CELL;
    ctx.fillStyle = "#9bbc0f";
    let ex = cx + CELL / 2;
    let ey = cy + CELL / 2;
    const off = 3;

    const lookingDir = (state.status === "running") ? state.dir : state.nextDir;

    switch (lookingDir) {
        case "up":
            ey -= off;
            break;
        case "down":
            ey += off;
            break;
        case "left":
            ex -= off;
            break;
        case "right":
            ex += off;
            break;
    }
    ctx.fillRect(ex - 1, ey - 1, 2, 2);
}

function queueDir(dir) {
    // Removed "running" check so input is always registered
    if (OPPOSITE[dir] === state.dir) return;
    if (dir !== state.nextDir) sound.turn();
    state.nextDir = dir;

    draw();
}

window.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === " " || k === "Spacebar") {
        e.preventDefault();
        if (state.status === "running") pause();
        else if (state.status === "paused") resume();
        else if (state.status === "menu") start();
        return;
    }
    if (k === "p" || k === "P") {
        if (state.status === "running") pause();
        else if (state.status === "paused") resume();
        return;
    }
    if (k === "Escape") {
        if (state.status === "running" || state.status === "paused") pause();
        return;
    }
    if (k === "ArrowUp" || k === "w" || k === "W") {
        e.preventDefault();
        queueDir("up");
    } else if (k === "ArrowDown" || k === "s" || k === "S") {
        e.preventDefault();
        queueDir("down");
    } else if (k === "ArrowLeft" || k === "a" || k === "A") {
        e.preventDefault();
        queueDir("left");
    } else if (k === "ArrowRight" || k === "d" || k === "D") {
        e.preventDefault();
        queueDir("right");
    }
});

document.querySelectorAll(".dpad__btn[data-dir]").forEach((btn) => {
    const dir = btn.getAttribute("data-dir");

    const press = (e) => {
        e.preventDefault();
        queueDir(dir);
    };

    btn.addEventListener("click", press);
    btn.addEventListener("touchstart", press, { passive: false });
});

pauseBtn.addEventListener("click", () => {
    if (state.status === "running") pause();
    else if (state.status === "paused") resume();
    else if (state.status === "menu") start();
    else if (state.status === "over") {
        restartCurrentLevel();
        start();
    }
});

soundBtn.addEventListener("click", () => sound.toggle());

let touchStart = null;
canvas.addEventListener(
    "touchstart",
    (e) => {
        const t = e.changedTouches[0];
        touchStart = { x: t.clientX, y: t.clientY };
    },
    { passive: true },
);
canvas.addEventListener(
    "touchend",
    (e) => {
        if (!touchStart) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - touchStart.x;
        const dy = t.clientY - touchStart.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 16) {
            touchStart = null;
            return;
        }
        if (state.status !== "running") return;
        if (Math.abs(dx) > Math.abs(dy)) queueDir(dx > 0 ? "right" : "left");
        else queueDir(dy > 0 ? "down" : "up");
        touchStart = null;
    },
    { passive: true },
);

if (!LEVELS[state.level]) state.level = "easy";
updateSoundUi();
reset();
setStatus("READY");
renderMenu();