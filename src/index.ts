import fs from "fs";

import { Compiler } from "./compiler/compiler.js";
import { Emulator } from "./emulator.js";
import { loadIrFromFile } from "./ir/irLoader.js";
import { Linker } from "./parser/linker.js";
import { UnitTester } from "./unitTests.js";

function linkCompileAndExecute(sourceFilePath: string) {
	const linker = new Linker(sourceFilePath);
	linker.enableDebug("../debug");
	const astProgram = linker.compile();
	const compiler = new Compiler(astProgram);
	const irProgram = compiler.compile();
	fs.writeFileSync("../debug/ir.txt", compiler.builder.getDebugText());
	const emulator = new Emulator(irProgram);
	emulator.execute();

	const unitTester = new UnitTester();
	unitTester.runTests();
}

function executeIrFile(irFilePath: string) {
	const debugIrContent = fs.readFileSync(irFilePath, "utf-8");
	const irProgram = loadIrFromFile(debugIrContent);

	const emulator = new Emulator(irProgram);
	emulator.execute();
}

linkCompileAndExecute("../source/funcTest.tcl3");
// executeIrFile("../debug/ir.txt");
