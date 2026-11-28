# Robot arm meshes

`kr16_2/` and `kr120r2500pro/` are the visual link meshes (`base_link`, `link_1` ... `link_6`, Collada) and the URDF
macros of the KUKA KR 16-2 and KR 120 R2500 pro from the ROS-Industrial repository
[ros-industrial/kuka_experimental](https://github.com/ros-industrial/kuka_experimental) (branch `melodic-devel`),
licensed under the Apache License 2.0 (full text: `LICENSE-kuka_experimental.txt`). The files are unmodified; at
runtime `frontend/src/scene3d/robotMeshes.ts` re-colours the RAL 2003 paint per robot and places each link in the
twin's joint frames. KUKA is a trademark of KUKA AG; this project is not affiliated with KUKA.
