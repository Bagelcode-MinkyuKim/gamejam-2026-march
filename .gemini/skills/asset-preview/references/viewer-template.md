# 3D Model Viewer Template

이 파일의 HTML을 `.asset-preview/viewer.html`로 복사하여 사용한다.
GLB/GLTF와 FBX를 모두 지원하며, 애니메이션 재생과 스켈레톤/와이어프레임/메쉬 토글이 가능하다.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Asset Preview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1a1a2e; overflow: hidden; font-family: monospace; }
    canvas { display: block; }
    #info {
      position: absolute; top: 10px; left: 10px;
      color: #eee; font-size: 13px;
      background: rgba(0,0,0,0.7); padding: 10px 14px; border-radius: 6px;
      line-height: 1.6;
    }
    #controls {
      position: absolute; bottom: 10px; left: 10px;
      color: #eee; font-size: 13px;
      background: rgba(0,0,0,0.7); padding: 8px 12px; border-radius: 6px;
      display: flex; gap: 4px; flex-wrap: wrap;
    }
    #controls button {
      background: #333; color: #eee; border: 1px solid #555;
      padding: 4px 10px; border-radius: 4px; cursor: pointer; font-family: monospace;
    }
    #controls button:hover { background: #555; }
    #controls button.active { background: #4a6fa5; border-color: #6a9fd5; }
    #help {
      position: absolute; bottom: 10px; right: 10px;
      color: #999; font-size: 11px;
      background: rgba(0,0,0,0.5); padding: 8px 12px; border-radius: 6px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div id="info">Loading...</div>
  <div id="controls"></div>
  <div id="help">
    Drag: Rotate | Scroll: Zoom | Right-drag: Pan
  </div>

  <script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
    }
  }
  </script>

  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
    import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

    const params = new URLSearchParams(location.search);
    const modelPath = params.get('model');

    // Scene
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    document.body.appendChild(renderer.domElement);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-5, 3, -5);
    scene.add(fillLight);

    // Grid
    const grid = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
    scene.add(grid);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;

    const clock = new THREE.Clock();
    let mixer = null;
    let skeletonHelper = null;

    const infoEl = document.getElementById('info');
    const controlsEl = document.getElementById('controls');

    // Shared setup after model is loaded
    function onModelLoaded(model, animations) {
      scene.add(model);

      // Auto-center and frame the model
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);

      camera.position.set(
        center.x + maxDim * 0.8,
        center.y + maxDim * 0.5,
        center.z + maxDim * 1.5
      );
      controls.target.copy(center);
      controls.update();

      // Count triangles and bones
      let triangles = 0;
      let boneCount = 0;
      model.traverse((child) => {
        if (child.isMesh && child.geometry) {
          const geo = child.geometry;
          triangles += geo.index
            ? geo.index.count / 3
            : geo.attributes.position.count / 3;
        }
        if (child.isBone) boneCount++;
      });

      // Add SkeletonHelper if bones exist
      if (boneCount > 0) {
        skeletonHelper = new THREE.SkeletonHelper(model);
        skeletonHelper.visible = true;
        scene.add(skeletonHelper);
      }

      // Display info
      const fileName = modelPath.split('/').pop();
      const infoLines = [
        `<b>${fileName}</b>`,
        `Triangles: ${Math.round(triangles).toLocaleString()}`,
        `Size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`,
        `Animations: ${animations.length}`,
      ];
      if (boneCount > 0) infoLines.push(`Bones: ${boneCount}`);
      infoEl.innerHTML = infoLines.join('<br>');

      // Skeleton toggle button
      if (boneCount > 0) {
        const skelBtn = document.createElement('button');
        skelBtn.textContent = 'Skeleton';
        skelBtn.classList.add('active');
        skelBtn.addEventListener('click', () => {
          skeletonHelper.visible = !skeletonHelper.visible;
          skelBtn.classList.toggle('active');
        });
        controlsEl.appendChild(skelBtn);

        // Wireframe toggle button
        const wireBtn = document.createElement('button');
        wireBtn.textContent = 'Wireframe';
        wireBtn.addEventListener('click', () => {
          const active = wireBtn.classList.toggle('active');
          model.traverse((child) => {
            if (child.isMesh) child.material.wireframe = active;
          });
        });
        controlsEl.appendChild(wireBtn);

        // Mesh visibility toggle
        const meshBtn = document.createElement('button');
        meshBtn.textContent = 'Mesh';
        meshBtn.classList.add('active');
        meshBtn.addEventListener('click', () => {
          const active = meshBtn.classList.toggle('active');
          model.traverse((child) => {
            if (child.isMesh) child.visible = active;
          });
        });
        controlsEl.appendChild(meshBtn);
      }

      // Animation controls
      if (animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        let activeBtn = null;

        animations.forEach((clip, i) => {
          const btn = document.createElement('button');
          btn.textContent = clip.name || `Anim ${i}`;
          btn.addEventListener('click', () => {
            mixer.stopAllAction();
            mixer.clipAction(clip).reset().play();
            if (activeBtn) activeBtn.classList.remove('active');
            btn.classList.add('active');
            activeBtn = btn;
          });
          controlsEl.appendChild(btn);

          // Auto-play the first animation
          if (i === 0) {
            mixer.clipAction(clip).play();
            btn.classList.add('active');
            activeBtn = btn;
          }
        });
      }
    }

    function onProgress(progress) {
      if (progress.total > 0) {
        const pct = Math.round((progress.loaded / progress.total) * 100);
        infoEl.textContent = `Loading... ${pct}%`;
      }
    }

    function onError(err) {
      infoEl.textContent = `Error: ${err.message}`;
      console.error('Loader error:', err);
    }

    if (!modelPath) {
      infoEl.textContent = 'No model specified.\nUse ?model=path/to/model.glb';
    } else {
      const ext = modelPath.split('.').pop().toLowerCase();

      if (ext === 'fbx') {
        // FBX loading
        new FBXLoader().load(
          modelPath,
          (fbx) => onModelLoaded(fbx, fbx.animations),
          onProgress,
          onError
        );
      } else {
        // GLB/GLTF loading (default)
        new GLTFLoader().load(
          modelPath,
          (gltf) => onModelLoaded(gltf.scene, gltf.animations),
          onProgress,
          onError
        );
      }
    }

    // Render loop
    function animate() {
      requestAnimationFrame(animate);
      const delta = clock.getDelta();
      if (mixer) mixer.update(delta);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Resize handler
    window.addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    });
  </script>
</body>
</html>
```
