# LSP build

The LSP uses the local `tlc3` compiler package from `../TCL3_Compiler`.
Install dependencies in both projects, then build the LSP:

```sh
cd ../TCL3_Compiler
npm install
cd ../TCL3_LSP
npm install
npm run build
```

The LSP's `prebuild` step builds the compiler first. The compiler emits declaration maps so TypeScript navigation can lead back to `TCL3_Compiler/src`.
