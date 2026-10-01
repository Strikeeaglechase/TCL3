import fs from "fs";

import { Compiler } from "./compiler/compiler.js";
import { loadIrFromFile } from "./compiler/ir.js";
import { Emulator } from "./emulator.js";
import { Linker } from "./linker.js";

function linkCompileAndExecute(sourceFilePath: string) {
	const linker = new Linker(sourceFilePath);
	linker.enableDebug("../debug");
	const astProgram = linker.compile();
	const compiler = new Compiler(astProgram);
	const irProgram = compiler.compile();
	fs.writeFileSync("../debug/ir.txt", compiler.builder.getDebugText());
	fs.writeFileSync("../debug/rawIr.txt", irProgram.join("\n"));
	const emulator = new Emulator();
	emulator.execute(irProgram);
}

function executeIrFile(irFilePath: string) {
	const debugIrContent = fs.readFileSync(irFilePath, "utf-8");
	const irProgram = loadIrFromFile(debugIrContent);

	const emulator = new Emulator();
	emulator.execute(irProgram);
}

// linkCompileAndExecute("../source/funcTest.tcl3");
executeIrFile("../debug/ir.txt");
