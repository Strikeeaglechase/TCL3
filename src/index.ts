import fs from "fs";

import { Compiler } from "./compiler/compiler.js";
import { Emulator } from "./emulator.js";
import { IRBuilder } from "./ir/irBuilder.js";
import { loadIrFromFile } from "./ir/irLoader.js";
import { IROptimizer } from "./ir/irOptimizer.js";
import { Linker } from "./parser/linker.js";
import { UnitTester } from "./unitTests.js";

function linkCompileAndExecute(sourceFilePath: string) {
	const linker = new Linker(sourceFilePath);
	linker.enableDebug("../debug");
	const astProgram = linker.compile();
	const compiler = new Compiler(astProgram);
	const irProgram = compiler.compile();
	fs.writeFileSync("../debug/ir.txt", IRBuilder.getDebugText(irProgram, false));
	const optimizer = new IROptimizer(irProgram);
	const optimizedIrProgram = optimizer.optimize();
	fs.writeFileSync("../debug/optimizedIr.txt", IRBuilder.getDebugText(optimizedIrProgram, false));
	const emulator = new Emulator(irProgram, true);
	const unoptResult = emulator.execute();
	const optimizedEmulator = new Emulator(optimizedIrProgram);
	const opResult = optimizedEmulator.execute();

	console.log(`Unoptimized ticks ${unoptResult.ticks}, Optimized ticks: ${opResult.ticks}`);

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
