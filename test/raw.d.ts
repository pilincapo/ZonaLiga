// Tipos para los imports ?raw de Vite (usados en los tests para leer el CSS).
declare module '*?raw' {
  const content: string;
  export default content;
}
