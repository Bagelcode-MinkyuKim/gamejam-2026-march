# 2D (pixi.js) 장르별 스타터 코드

## 플랫포머

```javascript
const app = new PIXI.Application();

async function init() {
    await app.init({
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: 0x87ceeb,
        resizeTo: window,
    });
    document.body.appendChild(app.canvas);

    // 플레이어
    const player = new PIXI.Graphics();
    player.rect(0, 0, 40, 40).fill(0xff0000);
    player.x = 100;
    player.y = 300;
    app.stage.addChild(player);

    // 바닥
    const ground = new PIXI.Graphics();
    ground.rect(0, 0, app.screen.width, 40).fill(0x228b22);
    ground.y = app.screen.height - 40;
    app.stage.addChild(ground);

    // 물리 상태
    let velocityY = 0;
    const gravity = 0.5;
    const jumpForce = -12;
    const moveSpeed = 5;
    const groundY = app.screen.height - 40 - 40;
    let isGrounded = false;

    // 키 입력
    const keys = {};
    window.addEventListener('keydown', (e) => keys[e.code] = true);
    window.addEventListener('keyup', (e) => keys[e.code] = false);

    // 터치 입력 (모바일)
    app.canvas.addEventListener('touchstart', () => {
        if (isGrounded) velocityY = jumpForce;
    });

    // 게임 루프
    app.ticker.add(() => {
        // 좌우 이동
        if (keys['ArrowLeft']) player.x -= moveSpeed;
        if (keys['ArrowRight']) player.x += moveSpeed;

        // 점프
        if (keys['Space'] && isGrounded) velocityY = jumpForce;

        // 중력
        velocityY += gravity;
        player.y += velocityY;

        // 바닥 충돌
        if (player.y >= groundY) {
            player.y = groundY;
            velocityY = 0;
            isGrounded = true;
        } else {
            isGrounded = false;
        }

        // 화면 밖 방지
        player.x = Math.max(0, Math.min(player.x, app.screen.width - 40));
    });
}

init();
```

---

## 탑다운 슈터

```javascript
const app = new PIXI.Application();

async function init() {
    await app.init({
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: 0x111111,
        resizeTo: window,
    });
    document.body.appendChild(app.canvas);

    // 플레이어
    const player = new PIXI.Graphics();
    player.circle(0, 0, 20).fill(0x00ff00);
    player.x = app.screen.width / 2;
    player.y = app.screen.height / 2;
    app.stage.addChild(player);

    const bullets = [];
    const enemies = [];
    const moveSpeed = 4;
    let score = 0;

    // 점수 텍스트
    const scoreText = new PIXI.Text({ text: '점수: 0', style: { fill: 0xffffff, fontSize: 24 } });
    scoreText.x = 10;
    scoreText.y = 10;
    app.stage.addChild(scoreText);

    // 키 입력
    const keys = {};
    window.addEventListener('keydown', (e) => keys[e.code] = true);
    window.addEventListener('keyup', (e) => keys[e.code] = false);

    // 클릭/터치로 총알 발사
    function shoot(targetX, targetY) {
        const bullet = new PIXI.Graphics();
        bullet.circle(0, 0, 4).fill(0xffff00);
        bullet.x = player.x;
        bullet.y = player.y;

        const angle = Math.atan2(targetY - player.y, targetX - player.x);
        bullet.vx = Math.cos(angle) * 8;
        bullet.vy = Math.sin(angle) * 8;

        app.stage.addChild(bullet);
        bullets.push(bullet);
    }

    app.canvas.addEventListener('pointerdown', (e) => {
        const rect = app.canvas.getBoundingClientRect();
        shoot(e.clientX - rect.left, e.clientY - rect.top);
    });

    // 적 생성 (2초마다)
    setInterval(() => {
        const enemy = new PIXI.Graphics();
        enemy.circle(0, 0, 15).fill(0xff0000);

        const side = Math.floor(Math.random() * 4);
        if (side === 0) { enemy.x = Math.random() * app.screen.width; enemy.y = -20; }
        else if (side === 1) { enemy.x = Math.random() * app.screen.width; enemy.y = app.screen.height + 20; }
        else if (side === 2) { enemy.x = -20; enemy.y = Math.random() * app.screen.height; }
        else { enemy.x = app.screen.width + 20; enemy.y = Math.random() * app.screen.height; }

        app.stage.addChild(enemy);
        enemies.push(enemy);
    }, 2000);

    // 게임 루프
    app.ticker.add(() => {
        // WASD 이동
        if (keys['KeyW'] || keys['ArrowUp']) player.y -= moveSpeed;
        if (keys['KeyS'] || keys['ArrowDown']) player.y += moveSpeed;
        if (keys['KeyA'] || keys['ArrowLeft']) player.x -= moveSpeed;
        if (keys['KeyD'] || keys['ArrowRight']) player.x += moveSpeed;

        // 총알 이동
        for (let i = bullets.length - 1; i >= 0; i--) {
            const b = bullets[i];
            b.x += b.vx;
            b.y += b.vy;
            if (b.x < -10 || b.x > app.screen.width + 10 || b.y < -10 || b.y > app.screen.height + 10) {
                app.stage.removeChild(b);
                bullets.splice(i, 1);
            }
        }

        // 적 이동 (플레이어를 향해)
        for (let i = enemies.length - 1; i >= 0; i--) {
            const e = enemies[i];
            const angle = Math.atan2(player.y - e.y, player.x - e.x);
            e.x += Math.cos(angle) * 1.5;
            e.y += Math.sin(angle) * 1.5;

            // 총알-적 충돌
            for (let j = bullets.length - 1; j >= 0; j--) {
                const b = bullets[j];
                const dist = Math.sqrt((b.x - e.x) ** 2 + (b.y - e.y) ** 2);
                if (dist < 19) {
                    app.stage.removeChild(b);
                    app.stage.removeChild(e);
                    bullets.splice(j, 1);
                    enemies.splice(i, 1);
                    score += 10;
                    scoreText.text = `점수: ${score}`;
                    break;
                }
            }
        }
    });
}

init();
```

---

## 클리커 / 아이들

```javascript
const app = new PIXI.Application();

async function init() {
    await app.init({
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: 0x2c3e50,
        resizeTo: window,
    });
    document.body.appendChild(app.canvas);

    let coins = 0;
    let clickPower = 1;
    let autoRate = 0;

    // 코인 텍스트
    const coinText = new PIXI.Text({ text: '코인: 0', style: { fill: 0xf1c40f, fontSize: 48, fontWeight: 'bold' } });
    coinText.anchor.set(0.5);
    coinText.x = app.screen.width / 2;
    coinText.y = 100;
    app.stage.addChild(coinText);

    // 클릭 버튼
    const button = new PIXI.Graphics();
    button.circle(0, 0, 80).fill(0xe74c3c);
    button.x = app.screen.width / 2;
    button.y = app.screen.height / 2;
    button.eventMode = 'static';
    button.cursor = 'pointer';
    app.stage.addChild(button);

    const buttonText = new PIXI.Text({ text: '클릭!', style: { fill: 0xffffff, fontSize: 24 } });
    buttonText.anchor.set(0.5);
    buttonText.x = button.x;
    buttonText.y = button.y;
    app.stage.addChild(buttonText);

    button.on('pointerdown', () => {
        coins += clickPower;
        coinText.text = `코인: ${coins}`;
        // 클릭 애니메이션
        button.scale.set(0.9);
        setTimeout(() => button.scale.set(1), 100);
    });

    // 업그레이드 버튼 만들기
    function createUpgrade(label, cost, y, onBuy) {
        const bg = new PIXI.Graphics();
        bg.roundRect(0, 0, 250, 50, 10).fill(0x3498db);
        bg.x = app.screen.width / 2 - 125;
        bg.y = y;
        bg.eventMode = 'static';
        bg.cursor = 'pointer';
        app.stage.addChild(bg);

        const text = new PIXI.Text({ text: `${label} (${cost} 코인)`, style: { fill: 0xffffff, fontSize: 16 } });
        text.anchor.set(0.5);
        text.x = bg.x + 125;
        text.y = bg.y + 25;
        app.stage.addChild(text);

        bg.on('pointerdown', () => {
            if (coins >= cost) {
                coins -= cost;
                onBuy();
                coinText.text = `코인: ${coins}`;
            }
        });
    }

    createUpgrade('클릭 파워 +1', 10, app.screen.height / 2 + 150, () => { clickPower += 1; });
    createUpgrade('자동 수입 +1/초', 50, app.screen.height / 2 + 220, () => { autoRate += 1; });

    // 자동 수입 (매 초)
    setInterval(() => {
        coins += autoRate;
        coinText.text = `코인: ${coins}`;
    }, 1000);
}

init();
```
