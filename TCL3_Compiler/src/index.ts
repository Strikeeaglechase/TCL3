import chalk from "chalk";
import fs from "fs";

import { Compiler } from "./compiler/compiler.js";
import { Emulator } from "./emulator.js";
import { IRBuilder } from "./ir/irBuilder.js";
import { compareIrPrograms, loadIrFromFile } from "./ir/irLoader.js";
import { IROptimizer } from "./ir/irOptimizer.js";
import { Linker } from "./linker/linker.js";
import { UnitTester } from "./unitTests.js";

const throwOnError = true;
function linkCompileAndExecute(sourceFilePath: string) {
	const linker = new Linker(sourceFilePath, { throwOnError: throwOnError });
	linker.enableDebug("../debug");
	const astProgram = linker.link();
	linker.getErrors().forEach(err => {
		console.log(chalk.redBright(`${err.constructor.name}: ${err.message}`));
		console.log(err.cause);
	});

	const compiler = new Compiler(astProgram, throwOnError);
	const irProgram = compiler.compile();
	fs.writeFileSync("../debug/ir.txt", IRBuilder.getDebugText(irProgram, false));
	compiler.errors.forEach(err => {
		console.log(chalk.redBright(`Compiler Error: ${err.message}`));
		console.log(err.cause);
	});

	const optimizer = new IROptimizer(irProgram);
	const optimizedIrProgram = optimizer.optimize();
	fs.writeFileSync("../debug/optimizedIr.txt", IRBuilder.getDebugText(optimizedIrProgram, false));

	const emulator = new Emulator(irProgram, true);
	const unoptResult = emulator.execute();
	const optimizedEmulator = new Emulator(optimizedIrProgram);
	const opResult = optimizedEmulator.execute();

	console.log(`Unoptimized ticks ${unoptResult.ticks}, Optimized ticks: ${opResult.ticks}`);

	// Test the IR loader to ensure it's able to re-create the IR program from a text file
	const loaderIr = loadIrFromFile(fs.readFileSync("../debug/ir.txt", "utf-8"));
	compareIrPrograms(irProgram, loaderIr);

	// const wat = new WATGenerator(optimizedIrProgram).generate();
	// fs.writeFileSync("../debug/program.wat", wat);
	// WATGenerator.compileToWasm("../debug/program.wat", "../debug/program.wasm");
	// WATGenerator.optimizeWasm("../debug/program.wasm", "../debug/opt_program.wasm", 0);

	// const runner = new WasmRunner("../debug/program.wasm");
	// runner.run();

	const unitTester = new UnitTester();
	unitTester.runTests();
}

function executeIrFile(irFilePath: string) {
	const debugIrContent = fs.readFileSync(irFilePath, "utf-8");
	const irProgram = loadIrFromFile(debugIrContent);

	const emulator = new Emulator(irProgram);
	emulator.execute();
}

// const artifacts = Linker.build("../source/tcl3Config.json");
// console.log(artifacts);

linkCompileAndExecute("../source/funcTest.tcl3");
// executeIrFile("../debug/ir.txt");
