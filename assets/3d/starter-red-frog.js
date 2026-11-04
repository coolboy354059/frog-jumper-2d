/**
 * Frog Jumper — Starter Red Frog (3D source model)
 *
 * Procedural Three.js model matching the original red starter-skin drawing
 * in index.html. The frog faces +Z and uses +Y as up.
 *
 * Usage:
 *   import { createStarterRedFrog } from "./starter-red-frog.js";
 *   const frog = createStarterRedFrog(THREE);
 *   scene.add(frog);
 *
 * Pass the THREE namespace from the version of Three.js used by the game.
 */
export const STARTER_RED_FROG = Object.freeze({
  id: "red",
  displayName: "Starter Red Frog",
  forwardAxis: "+Z",
  upAxis: "+Y",
  palette: Object.freeze({
    leg: "#b51f35",
    body: "#ef334b",
    head: "#d92743",
    belly: "#ff9b9b",
    eye: "#f9fff0",
    pupil: "#132c32",
    highlight: "#ffffff",
    cheek: "#ff8a93",
    mouth: "#81172a"
  })
});

export function createStarterRedFrog(THREE) {
  const required = [
    "Group", "Mesh", "SphereGeometry", "MeshStandardMaterial",
    "Vector3", "CatmullRomCurve3", "TubeGeometry"
  ];
  for (const key of required) {
    if (!THREE || !THREE[key]) {
      throw new TypeError(`createStarterRedFrog needs THREE.${key}`);
    }
  }

  const root = new THREE.Group();
  root.name = "FrogRoot";
  root.userData.skinId = STARTER_RED_FROG.id;
  root.userData.displayName = STARTER_RED_FROG.displayName;
  root.userData.forwardAxis = "+Z";

  const sphereGeometry = new THREE.SphereGeometry(1, 24, 16);
  const makeMaterial = (color, roughness = 0.78) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness: 0
    });

  const materials = {
    leg: makeMaterial(STARTER_RED_FROG.palette.leg),
    body: makeMaterial(STARTER_RED_FROG.palette.body, 0.72),
    head: makeMaterial(STARTER_RED_FROG.palette.head, 0.68),
    belly: makeMaterial(STARTER_RED_FROG.palette.belly, 0.84),
    eye: makeMaterial(STARTER_RED_FROG.palette.eye, 0.35),
    pupil: makeMaterial(STARTER_RED_FROG.palette.pupil, 0.42),
    highlight: makeMaterial(STARTER_RED_FROG.palette.highlight, 0.25),
    cheek: makeMaterial(STARTER_RED_FROG.palette.cheek, 0.8),
    mouth: makeMaterial(STARTER_RED_FROG.palette.mouth, 0.75)
  };

  function addSphere(name, position, scale, material) {
    const part = new THREE.Mesh(sphereGeometry, material);
    part.name = name;
    part.position.set(...position);
    part.scale.set(...scale);
    part.castShadow = true;
    part.receiveShadow = true;
    root.add(part);
    return part;
  }

  // Little feet tucked under the wide rounded body.
  addSphere("Left foot", [-0.30, 0.13, -0.005], [0.155, 0.19, 0.205], materials.leg);
  addSphere("Right foot", [0.30, 0.13, -0.005], [0.155, 0.19, 0.205], materials.leg);

  // Main red body and the pale pink patch on its front.
  addSphere("Main red body", [0, 0.39, -0.015], [0.49, 0.36, 0.37], materials.body);
  addSphere("Pale belly", [0, 0.285, 0.338], [0.285, 0.155, 0.052], materials.belly);

  // Raised red eye bumps, large ivory eyes, dark pupils, and tiny glints.
  for (const [side, x] of [["Left", -0.225], ["Right", 0.225]]) {
    addSphere(`${side} raised eye mound`, [x, 0.755, 0.105], [0.175, 0.205, 0.19], materials.head);
    addSphere(`${side} eye`, [x, 0.775, 0.263], [0.132, 0.153, 0.125], materials.eye);
    const pupilX = x + 0.025;
    addSphere(`${side} pupil`, [pupilX, 0.748, 0.378], [0.057, 0.070, 0.035], materials.pupil);
    addSphere(`${side} eye glint`, [pupilX - 0.016, 0.783, 0.409], [0.018, 0.021, 0.012], materials.highlight);
  }

  // Rosy cheeks, matching the red starter sprite.
  addSphere("Left cheek", [-0.385, 0.43, 0.30], [0.067, 0.052, 0.035], materials.cheek);
  addSphere("Right cheek", [0.385, 0.43, 0.30], [0.067, 0.052, 0.035], materials.cheek);

  // A thin curved smile on the front of the belly.
  const smilePoints = [];
  for (let i = 0; i <= 8; i += 1) {
    const t = -1 + (i / 4);
    smilePoints.push(new THREE.Vector3(
      0.145 * t,
      0.345 - 0.055 * (1 - t * t),
      0.392
    ));
  }
  const smileCurve = new THREE.CatmullRomCurve3(smilePoints);
  const smile = new THREE.Mesh(
    new THREE.TubeGeometry(smileCurve, 24, 0.008, 6, false),
    materials.mouth
  );
  smile.name = "Curved friendly smile";
  root.add(smile);

  return root;
}
