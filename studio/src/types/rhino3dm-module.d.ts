// The ES-module build of rhino3dm (the package's declarations cover only the
// CommonJS entry). Enum values are runtime objects; see core/rhinoImport.ts.
declare module 'rhino3dm/rhino3dm.module.js' {
  const factory: (options?: { locateFile?: (path: string) => string }) => Promise<unknown>;
  export default factory;
}
