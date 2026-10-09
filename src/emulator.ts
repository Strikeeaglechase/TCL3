import { IRArgument, IRCodeLine, IRLabelLine, IROpCode, IRProgram, Register } from "./ir/ir.js";

const memSize = 1024 * 64; // 64KB

class Emulator {
	private registers: Record<Register, number> = {
		[Register.pc]: 0,
		[Register.sp]: 0,
		[Register.fp]: 0,
		[Register.memPtr]: 0,
		[Register.r0]: 0,
		[Register.r1]: 0,
		[Register.funcRet]: 0
	};

	private memory: number[] = new Array(memSize).fill(0);
	private running: boolean = true;
	private ticks = 0;
	private stringLut: Map<number, number> = new Map(); // Maps string index to memory address
	private labelIndexes: Map<string, number> = new Map(); // Maps label names to program index

	private outputs: number[] = [];

	constructor(
		private program: IRProgram,
		private silent = false
	) {
		// Place strings into memory
		let currentStringAddress = 0;
		this.program.strings.forEach((str, index) => {
			this.stringLut.set(index, currentStringAddress);
			for (let i = 0; i < str.length; i++) {
				this.memory[currentStringAddress + i] = str.charCodeAt(i);
			}

			currentStringAddress += str.length;
		});

		// Load label indexes
		this.program.code.forEach((line, index) => {
			if (line instanceof IRLabelLine) {
				if (this.labelIndexes.has(line.label)) throw new Error(`Duplicate label found: ${line.label}`);
				this.labelIndexes.set(line.label, index);
			}
		});

		this.registers.fp = currentStringAddress + 5;
		this.registers.sp = currentStringAddress + 5;
	}

	public execute() {
		while (this.running) {
			const line = this.program.code[this.registers.pc];

			if (line instanceof IRCodeLine) {
				this.executeInstruction(line.opcode, line.args);
				this.ticks++;
			}

			this.registers.pc += 1;
		}

		if (!this.silent) console.log(`Execution finished after ${this.ticks} ticks.`);

		return {
			outputs: this.outputs,
			ticks: this.ticks
		};
	}

	private executeInstruction(opcode: IROpCode, args: IRArgument[]) {
		// if (!this.silent) console.log(`PC: ${this.registers.pc} - ${opcode} ${args.join(", ")}`);
		switch (opcode) {
			case "MOV":
				this.setValue(args[1], this.getValue(args[0]));
				break;

			case "PUSH":
				this.memory[this.registers.sp] = this.getValue(args[0]);
				this.registers.sp += 1;
				break;

			case "POP":
				this.registers.sp -= 1;
				this.setValue(args[0], this.memory[this.registers.sp]);
				break;

			case "ADD":
				const sum = this.getValue(args[0]) + this.getValue(args[1]);
				this.setValue(args[2], sum);
				break;

			case "SUB":
				const diff = this.getValue(args[0]) - this.getValue(args[1]);
				this.setValue(args[2], diff);
				break;

			case "MUL":
				const prod = this.getValue(args[0]) * this.getValue(args[1]);
				this.setValue(args[2], prod);
				break;

			case "DIV":
				const quotient = Math.floor(this.getValue(args[0]) / this.getValue(args[1]));
				this.setValue(args[2], quotient);
				break;

			case "EQ":
				const eqResult = this.getValue(args[0]) == this.getValue(args[1]) ? 1 : 0;
				this.setValue(args[2], eqResult);
				break;

			case "NEQ":
				const neqResult = this.getValue(args[0]) != this.getValue(args[1]) ? 1 : 0;
				this.setValue(args[2], neqResult);
				break;

			case "GT":
				const gtResult = this.getValue(args[0]) > this.getValue(args[1]) ? 1 : 0;
				this.setValue(args[2], gtResult);
				break;

			case "GTE":
				const gteResult = this.getValue(args[0]) >= this.getValue(args[1]) ? 1 : 0;
				this.setValue(args[2], gteResult);
				break;

			case "LOGIC_AND":
				const andResult = this.getValue(args[0]) && this.getValue(args[1]) ? 1 : 0;
				this.setValue(args[2], andResult);
				break;

			case "LOGIC_OR":
				const orResult = this.getValue(args[0]) || this.getValue(args[1]) ? 1 : 0;
				this.setValue(args[2], orResult);
				break;

			case "AND":
				const bitwiseAndResult = this.getValue(args[0]) & this.getValue(args[1]);
				this.setValue(args[2], bitwiseAndResult);
				break;

			case "OR":
				const bitwiseOrResult = this.getValue(args[0]) | this.getValue(args[1]);
				this.setValue(args[2], bitwiseOrResult);
				break;

			case "NOT":
				const bitwiseNotResult = ~this.getValue(args[0]);
				this.setValue(args[1], bitwiseNotResult);
				break;

			case "NEG":
				const negResult = -this.getValue(args[0]);
				this.setValue(args[1], negResult);
				break;

			case "XOR":
				const bitwiseXorResult = this.getValue(args[0]) ^ this.getValue(args[1]);
				this.setValue(args[2], bitwiseXorResult);
				break;

			case "SHL":
				const shlResult = this.getValue(args[0]) << this.getValue(args[1]);
				this.setValue(args[2], shlResult);
				break;

			case "SHR":
				const shrResult = this.getValue(args[0]) >> this.getValue(args[1]);
				this.setValue(args[2], shrResult);
				break;

			case "JMP_IF_TRUE":
				if (this.getValue(args[0]) != 0) this.registers.pc = this.getValue(args[1]);
				break;

			case "JMP_IF_FALSE":
				if (this.getValue(args[0]) == 0) this.registers.pc = this.getValue(args[1]);
				break;

			case "NOP":
				break;

			case "HALT":
				this.running = false;
				break;

			case "OUT":
				const value = this.getValue(args[0]);
				if (!this.silent) console.log(`OUT: ${value}`);
				this.outputs.push(value);
				break;

			case "INSPECT":
				this.handleInspect();
				break;

			default:
				throw new Error(`Unknown opcode: ${opcode}`);
		}
	}

	private handleInspect() {
		let registerOutput = `Tick: ${this.ticks} | `;
		Object.entries(this.registers).forEach(([reg, value]) => {
			registerOutput += `${reg}: ${value} | `;
		});

		console.log(registerOutput);
		const snapshotSize = 32;
		const table: string[][] = [];
		table.push([`Addresses:`]);
		table.push([`Memory:`]);
		table.push([`Registers:`]);

		this.memory.slice(0, snapshotSize).forEach((val, index) => {
			table[0].push(index.toString());
			table[1].push(val.toString());

			if (this.registers.sp === index) table[2].push("^SP");
			else if (this.registers.fp === index) table[2].push("^FP");
			else table[2].push("");
		});

		const maxColWidths: number[] = [];
		for (let col = 0; col < table[0].length; col++) {
			maxColWidths[col] = Math.max(...table.map(row => row[col]?.length || 0));
		}

		table.forEach(row => {
			const paddedRow = row.map((cell, colIndex) => cell.padEnd(maxColWidths[colIndex], " "));
			console.log(paddedRow.join(" "));
		});
	}

	private setValue(arg: IRArgument, value: number) {
		switch (arg.type) {
			case "MEM":
				this.memory[parseInt(arg.value)] = value;
				break;
			case "MEM_REG":
				if (!(arg.value in this.registers)) throw new Error(`Invalid register: ${arg.value}`);
				const addr = this.registers[arg.value as Register] + (arg.offset || 0);
				this.memory[addr] = value;
				break;
			case "REG":
				if (!(arg.value in this.registers)) throw new Error(`Invalid register: ${arg.value}`);
				this.registers[arg.value as Register] = value;
				break;
			default:
				throw new Error(`Unsupported argument type for setValue: ${arg.type}`);
		}
	}

	private getValue(arg: IRArgument): number {
		switch (arg.type) {
			case "IMM":
				return parseInt(arg.value);
			case "REG":
				if (!(arg.value in this.registers)) throw new Error(`Invalid register: ${arg.value}`);
				return this.registers[arg.value as Register];
			case "MEM":
				const val = this.memory[parseInt(arg.value)];
				if (typeof val != "number") throw new Error(`Invalid memory access at address ${arg.value}: ${val}`);
				return val;
			case "MEM_REG":
				if (!(arg.value in this.registers)) throw new Error(`Invalid register: ${arg.value}`);
				const addr = this.registers[arg.value as Register] + (arg.offset || 0);
				const memVal = this.memory[addr];
				if (typeof memVal != "number") throw new Error(`Invalid memory access at address ${addr}: ${memVal}`);
				return memVal;
			case "LABEL":
				if (!this.labelIndexes.has(arg.value)) throw new Error(`Label not found: ${arg.value}`);
				return this.labelIndexes.get(arg.value)!;
			case "STR":
				const strIndex = parseInt(arg.value);
				if (!this.stringLut.has(strIndex)) throw new Error(`String index not found: ${strIndex}`);
				return this.stringLut.get(strIndex)!;
			default:
				throw new Error(`Unsupported argument type: ${arg.type}`);
		}
	}
}

export { Emulator };
