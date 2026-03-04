# 3D (three.js) 장르별 스타터 코드

## FPS / 1인칭 탐색

```javascript
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 50, 200);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// 조명
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(10, 20, 10);
sun.castShadow = true;
scene.add(sun);

// 바닥
const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x228b22 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// 포인터 락 컨트롤
const controls = new PointerLockControls(camera, document.body);
document.body.addEventListener('click', () => controls.lock());

// 이동
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const moveSpeed = 50;
const keys = {};
window.addEventListener('keydown', (e) => keys[e.code] = true);
window.addEventListener('keyup', (e) => keys[e.code] = false);

camera.position.set(0, 1.6, 5);

// 리사이즈
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// 게임 루프
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (controls.isLocked) {
        // 감속
        velocity.x -= velocity.x * 10 * delta;
        velocity.z -= velocity.z * 10 * delta;

        // 입력
        direction.z = Number(keys['KeyW'] || keys['ArrowUp']) - Number(keys['KeyS'] || keys['ArrowDown']);
        direction.x = Number(keys['KeyD'] || keys['ArrowRight']) - Number(keys['KeyA'] || keys['ArrowLeft']);
        direction.normalize();

        if (keys['KeyW'] || keys['ArrowUp'] || keys['KeyS'] || keys['ArrowDown']) velocity.z -= direction.z * moveSpeed * delta;
        if (keys['KeyA'] || keys['ArrowLeft'] || keys['KeyD'] || keys['ArrowRight']) velocity.x -= direction.x * moveSpeed * delta;

        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);
    }

    renderer.render(scene, camera);
}

animate();
```

---

## 엔드리스 러너

```javascript
import * as THREE from 'three';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// 조명
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(5, 10, 7);
scene.add(sun);

// 바닥 타일 (무한 스크롤 효과)
const groundTiles = [];
const tileLength = 20;
const tileCount = 5;
for (let i = 0; i < tileCount; i++) {
    const tile = new THREE.Mesh(
        new THREE.PlaneGeometry(6, tileLength),
        new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? 0x444444 : 0x555555 })
    );
    tile.rotation.x = -Math.PI / 2;
    tile.position.z = -i * tileLength;
    scene.add(tile);
    groundTiles.push(tile);
}

// 플레이어
const player = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xff0000 })
);
player.position.set(0, 0.4, 0);
scene.add(player);

// 장애물
const obstacles = [];
function spawnObstacle() {
    const obstacle = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0x00aa00 })
    );
    obstacle.position.set((Math.random() - 0.5) * 4, 0.5, -60);
    scene.add(obstacle);
    obstacles.push(obstacle);
}

// 카메라 위치
camera.position.set(0, 4, 6);
camera.lookAt(0, 0, -5);

// 게임 상태
let speed = 10;
let score = 0;
let lane = 0; // -1, 0, 1
const laneWidth = 2;
let isGameOver = false;

// 입력
window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft' && lane > -1) lane--;
    if (e.code === 'ArrowRight' && lane < 1) lane++;
});
// 터치: 좌/우 절반 터치
window.addEventListener('touchstart', (e) => {
    const x = e.touches[0].clientX;
    if (x < window.innerWidth / 2 && lane > -1) lane--;
    else if (x >= window.innerWidth / 2 && lane < 1) lane++;
});

// 리사이즈
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// 장애물 생성 타이머
let spawnTimer = 0;

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    if (isGameOver) return;

    const delta = clock.getDelta();
    score += delta * 10;

    // 바닥 스크롤
    groundTiles.forEach(tile => {
        tile.position.z += speed * delta;
        if (tile.position.z > tileLength) {
            tile.position.z -= tileCount * tileLength;
        }
    });

    // 플레이어 레인 이동 (부드럽게)
    const targetX = lane * laneWidth;
    player.position.x += (targetX - player.position.x) * 10 * delta;

    // 장애물 이동 + 충돌
    for (let i = obstacles.length - 1; i >= 0; i--) {
        const ob = obstacles[i];
        ob.position.z += speed * delta;
        if (ob.position.z > 5) {
            scene.remove(ob);
            obstacles.splice(i, 1);
            continue;
        }
        // 충돌 감지
        if (Math.abs(ob.position.x - player.position.x) < 0.8 &&
            Math.abs(ob.position.z - player.position.z) < 0.8) {
            isGameOver = true;
        }
    }

    // 장애물 생성
    spawnTimer += delta;
    if (spawnTimer > 1.5) {
        spawnObstacle();
        spawnTimer = 0;
    }

    // 속도 점진 증가
    speed += delta * 0.2;

    renderer.render(scene, camera);
}

animate();
```

---

## 3D 퍼즐 / 오브젝트 상호작용

```javascript
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x333333);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// 조명
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(5, 10, 7);
scene.add(sun);

// 궤도 컨트롤 (마우스 회전/줌)
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// 바닥
const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x888888 })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// 인터랙티브 오브젝트 생성
const objects = [];
const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff];
for (let i = 0; i < 5; i++) {
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: colors[i] })
    );
    mesh.position.set((i - 2) * 2, 0.5, 0);
    mesh.userData = { originalY: 0.5, selected: false };
    scene.add(mesh);
    objects.push(mesh);
}

camera.position.set(0, 8, 8);
controls.target.set(0, 0, 0);

// 레이캐스터 (클릭 감지)
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function onPointerDown(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(objects);

    if (intersects.length > 0) {
        const obj = intersects[0].object;
        obj.userData.selected = !obj.userData.selected;

        // 선택 시 위로 올라감
        if (obj.userData.selected) {
            obj.position.y = 2;
            obj.material.emissive.setHex(0x333333);
        } else {
            obj.position.y = obj.userData.originalY;
            obj.material.emissive.setHex(0x000000);
        }
    }
}

renderer.domElement.addEventListener('pointerdown', onPointerDown);

// 리사이즈
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// 게임 루프
function animate() {
    requestAnimationFrame(animate);
    controls.update();

    // 선택된 오브젝트 회전
    objects.forEach(obj => {
        if (obj.userData.selected) {
            obj.rotation.y += 0.02;
        }
    });

    renderer.render(scene, camera);
}

animate();
```
