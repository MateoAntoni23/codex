import { Grid } from '@react-three/drei';

// Piso: 30 000 mm × 30 000 mm → 30 m × 30 m en Three.js (1 unidad = 1 m)
// La grilla tiene celdas de 1 m (= 1000 mm)
export function Floor() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#2a2a3a" />
      </mesh>
      <Grid
        args={[30, 30]}
        cellSize={1}
        cellThickness={0.4}
        cellColor="#444466"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#6666aa"
        fadeDistance={60}
        fadeStrength={1}
        followCamera={false}
        infiniteGrid={false}
      />
    </>
  );
}
