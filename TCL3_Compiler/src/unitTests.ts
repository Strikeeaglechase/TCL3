import chalk from "chalk";
import fs from "fs";
import path from "path";

import { Compiler } from "./compiler/compiler.js";
import { Emulator } from "./emulator.js";
import { IROptimizer } from "./ir/irOptimizer.js";
import { Linker } from "./parser/linker.js";

interface TestFile {
	name: string;
	content: string;
	filePath: string;
	expectedOutput: number[];
	expectsCompileError: boolean;
}

class UnitTester {
	private testFilePaths: string[] = [];

	constructor() {
		this.testFilePaths = fs
			.readdirSync(`../unitTests`)
			.filter(file => file.endsWith(`.tcl3`))
			.map(file => `../unitTests/${file}`);
	}

	private loadTestFile(filePath: string): TestFile {
		const content = fs.readFileSync(`../unitTests/${filePath}`, "utf-8");
		const expectedOutputMatches = [...content.matchAll(/\/\/ ?EXPECT: ?(.+)/gi)];
		const expectedOutput = expectedOutputMatches.flatMap(match => {
			const isNumeric = match[1].trim().match(/^-?\d+$/);
			if (isNumeric) return [parseInt(match[1])];

			return match[1]
				.trim()
				.split("")
				.map(char => char.charCodeAt(0));
		});
		const expectsCompileError = /\/\/ ?EXPECT_COMPILE_ERROR\b/i.test(content);

		return {
			name: path.basename(filePath, path.extname(filePath)),
			filePath: filePath,
			content,
			expectedOutput,
			expectsCompileError
		};
	}

	public runTests() {
		const testFiles = this.testFilePaths.map(filePath => this.loadTestFile(filePath));
		let allPassed = true;
		let passCount = 0;
		let optPassCount = 0;
		let ticks = 0;
		let optTicks = 0;

		const start = Date.now();
		for (const testFile of testFiles) {
			if (testFile.expectedOutput.length == 0 && !testFile.expectsCompileError) {
				console.log(chalk.gray(`Skipping ${testFile.name} (no expected output)`));
				continue;
			}

			if (testFile.expectsCompileError) {
				try {
					this.compileTest(testFile);
					console.log(chalk.red(`Test ${testFile.name} failed, expected compilation to fail`));
					allPassed = false;
				} catch {
					console.log(chalk.blueBright(`Test ${testFile.name} passed`));
					passCount++;
					optPassCount++;
				}
				continue;
			}

			try {
				const result = this.runTest(testFile);
				if (!result.passed) allPassed = false;

				passCount += result.totalTests - result.failCount;
				optPassCount += result.totalTests - result.optimizedFailCount;
				ticks += result.ticks;
				optTicks += result.optimizedTicks;
			} catch (err) {
				console.log(chalk.red(`Test ${testFile.name} failed with error: ${err.message}`));
				allPassed = false;
			}
		}

		const totalTests = testFiles.reduce((sum, file) => {
			if (file.expectsCompileError) return sum + 1;
			return sum + file.expectedOutput.length;
		}, 0);

		const end = Date.now();
		let rStr = `${optPassCount}/${totalTests}`;
		if (allPassed) rStr = chalk.green(rStr);
		else rStr = chalk.red(rStr);

		const reduction = ((ticks - optTicks) / ticks) * 100;
		console.log(rStr + chalk.blue(` tests passed in ${end - start}ms. ${ticks} ticks unopt, ${optTicks} optimized (${reduction.toFixed(0)}% reduction).`));
	}

	private compileTest(file: TestFile) {
		const linker = new Linker(file.filePath);
		const astProg = linker.compile();
		const compiler = new Compiler(astProg);
		return compiler.compile();
	}

	private runTest(file: TestFile) {
		const output = this.compileTest(file);
		const optimizer = new IROptimizer(output);
		const optimizedOutput = optimizer.optimize();
		const emulator = new Emulator(output, true);
		const optimizedEmulator = new Emulator(optimizedOutput, true);
		const result = emulator.execute();
		const optimizedResult = optimizedEmulator.execute();

		let failCount = 0;
		let optimizedFailCount = 0;
		file.expectedOutput.forEach((expected, index) => {
			if (result.outputs[index] != expected) {
				console.log(chalk.red(`Test ${file.name} failed on case ${index}, expected ${expected}, got ${result.outputs[index]}`));
				failCount++;
			}

			if (optimizedResult.outputs[index] != expected) {
				console.log(chalk.red(`Optimized test ${file.name} failed on case ${index}, expected ${expected}, got ${optimizedResult.outputs[index]}`));
				optimizedFailCount++;
			}
		});

		if (failCount == 0 && optimizedFailCount == 0) {
			console.log(chalk.blueBright(`Test ${file.name} passed`));
		} else if (failCount > 0 && optimizedFailCount == 0) {
			console.log(chalk.red(`Somehow, ${file.name} fails unoptimized but passes optimized`));
		} else if (failCount == 0 && optimizedFailCount > 0) {
			console.log(chalk.yellow(`Test ${file.name} passes unoptimized but fails optimized`));
		}

		return {
			passed: failCount == 0 && optimizedFailCount == 0,
			failCount,
			optimizedFailCount,
			totalTests: file.expectedOutput.length,
			ticks: result.ticks,
			optimizedTicks: optimizedResult.ticks
		};
	}
}

export { UnitTester };
