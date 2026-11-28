# Sketchfab models (CC BY 4.0)

Both models are licensed under Creative Commons Attribution 4.0 International
(https://creativecommons.org/licenses/by/4.0/). Files renamed only; at runtime RootTwin scales and places them and
overlays its own internal parts (spindle, gearbox) for diagnosis.

- `cnc/cnc.glb`: "CNC Machine" (https://skfb.ly/af387e70d78a4ba4886af58dd7aec96b) by Khushbushah
  (https://sketchfab.com/Khushbushah), licensed under CC BY 4.0.
- `press/press.glb`: "Press Machine System" (https://sketchfab.com/3d-models/press-machine-system-3356ec2ec7934cc29cbc72a9b96f694d)
  by oreshker (https://sketchfab.com/oreshker), licensed under CC BY 4.0. The author states it was generated with Meshy
  (AI); it is a single mesh, so it fades and X-rays but does not explode into parts.

- `cabinet/cabinet.glb`: "Electrical Distribution Cabinet" (https://sketchfab.com/3d-models/electrical-distribution-cabinet-5dd2ce8a5baf4efca7179ed821084a21)
  by Arsen Ismailov (https://sketchfab.com/fdgasd7), licensed under CC BY 4.0. Used as the PLC / electrical cabinet bank.
- `fence/fence.glb`: "Wire Mesh Panels" (https://sketchfab.com/3d-models/wire-mesh-panels-28e3e4f2c5534a01b48e3d4d04a35124)
  by GameDevMoot (https://sketchfab.com/GameDevMoot), licensed under CC BY 4.0. Used for the robot cell guarding.

## Optimisation

Both files were compressed with glTF-Transform (meshopt geometry compression, 35 % / 25 % vertex simplification,
WebP textures at max 1024 px), keeping every separate mesh of the CNC:

    npx @gltf-transform/cli@4 optimize in.glb out.glb --join false --flatten false --instance false --palette false \
      --simplify true --simplify-ratio 0.35 --simplify-error 0.001 --compress meshopt --texture-compress webp --texture-size 1024

CNC 28.1 MB -> 2.6 MB, press 24.8 MB -> 2.2 MB, cabinet 9.5 MB -> 0.75 MB, fence 6.7 MB -> 1.2 MB (press: --simplify-ratio 0.25 --simplify-error 0.002).
The twin loads them with useGLTF(url, false, true): the meshopt decoder is bundled, no CDN needed.
