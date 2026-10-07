import chalk from "chalk";
import fs from "fs";
import path from "path";

import { Compiler } from "./compiler/compiler.js";
import { Emulator } from "./emulator.js";
import { Linker } from "./parser/linker.js";

interface TestFile {
	name: string;
	content: string;
	filePath: string;
	expectedOutput: number[];
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

		return {
			name: path.basename(filePath, path.extname(filePath)),
			filePath: filePath,
			content,
			expectedOutput
		};
	}

	public runTests() {
		const testFiles = this.testFilePaths.map(filePath => this.loadTestFile(filePath));
		let allPassed = true;
		let passCount = 0;
		let ticks = 0;

		const start = Date.now();
		for (const testFile of testFiles) {
			if (testFile.expectedOutput.length == 0) {
				console.log(chalk.gray(`Skipping ${testFile.name} (no expected output)`));
				continue;
			}

			try {
				const result = this.runTest(testFile);
				if (!result.passed) allPassed = false;

				passCount += result.totalTests - result.failCount;
				ticks += result.ticks;
			} catch (err) {
				console.log(chalk.red(`Test ${testFile.name} failed with error: ${err.message}`));
				allPassed = false;
			}
		}

		const totalTests = testFiles.reduce((sum, file) => sum + file.expectedOutput.length, 0);

		const end = Date.now();
		let rStr = `${passCount}/${totalTests}`;
		if (allPassed) rStr = chalk.green(rStr);
		else rStr = chalk.red(rStr);

		console.log(rStr + chalk.blue(` tests passed in ${end - start}ms. ${ticks} ticks executed.`));
	}

	private runTest(file: TestFile) {
		const linker = new Linker(file.filePath);
		const astProg = linker.compile();
		const compiler = new Compiler(astProg);
		const output = compiler.compile();
		const emulator = new Emulator(output, true);
		const result = emulator.execute();

		let failCount = 0;
		file.expectedOutput.forEach((expected, index) => {
			if (result.outputs[index] == expected) return;

			console.log(chalk.red(`Test ${file.name} failed on case ${index}, expected ${expected}, got ${result.outputs[index]}`));
			failCount++;
		});

		if (failCount == 0) console.log(chalk.blueBright(`Test ${file.name} passed`));

		return {
			passed: failCount == 0,
			failCount,
			totalTests: file.expectedOutput.length,
			ticks: result.ticks
		};
	}
}

export { UnitTester };
