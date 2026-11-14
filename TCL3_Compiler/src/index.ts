import chalk from "chalk";
import fs from "fs";

import { Compiler } from "./compiler/compiler.js";
import { Emulator } from "./emulator.js";
import { IRBuilder } from "./ir/irBuilder.js";
import { loadIrFromFile } from "./ir/irLoader.js";
import { IROptimizer } from "./ir/irOptimizer.js";
import { Linker } from "./linker/linker.js";
import { UnitTester } from "./unitTests.js";

const throwOnError = true;
function linkCompileAndExecute(sourceFilePath: string) {
	const linker = new Linker(sourceFilePath, { throwOnError: throwOnError });
	linker.enableDebug("../debug");
	const astProgram = linker.link();
	linker.getErrors().forEach(err => {
		console.log(chalk.redBright(`Linker Error: ${err.message}`));
	});

	const compiler = new Compiler(astProgram, throwOnError);
	const irProgram = compiler.compile();
	fs.writeFileSync("../debug/ir.txt", IRBuilder.getDebugText(irProgram, false));
	compiler.errors.forEach(err => {
		console.log(chalk.redBright(`Compiler Error: ${err.message}`));
	});

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
