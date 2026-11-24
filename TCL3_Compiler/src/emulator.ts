import { IRArgument, IRArgumentType, IRCodeLine, IRLabelLine, IROpCode, IRProgram, Register } from "./ir/ir.js";
import { INT_SIZE } from "./ir/irBuilder.js";

const memSize = 1024 * 64; // 64KB

const floatAddresses = new Set<number>();
function write(mem: number[], address: number, value: number, size: number) {
	// What im about to do im not proud of, but this is javascripts fault
	// in a proper language id just get to write the nice raw bits, call it good
	// but because js, I have to guess if its an int or a float

	if (size === 4 && !Number.isInteger(value)) {
		const floatArray = new Float32Array(1);
		floatArray[0] = value;
		const intArray = new Uint8Array(floatArray.buffer);

		for (let i = 0; i < size; i++) {
			mem[address + i] = intArray[i];
		}

		floatAddresses.add(address);

		return;
	}

	floatAddresses.delete(address);

	for (let i = 0; i < size; i++) {
		const byte = (value >> (i * 8)) & 0xff;
		mem[address + i] = byte;
	}
}

function read(mem: number[], address: number, size: number): number {
	if (floatAddresses.has(address) && size == 4) {
		const intArray = new Uint8Array(size);
		for (let i = 0; i < size; i++) {
			intArray[i] = mem[address + i];
		}

		const floatArray = new Float32Array(intArray.buffer);
		return floatArray[0];
	}

	let value = 0;
	for (let i = 0; i < size; i++) {
		value |= (mem[address + i] & 0xff) << (i * 8);
	}

	return value;
}

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

	private lineBuffer = "";

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
			if (!line) throw new Error(`Program counter out of bounds: ${this.registers.pc}`);

			if (line instanceof IRCodeLine) {
				this.executeInstruction(line.opcode, line.args);
				this.ticks++;
			}

			this.registers.pc += 1;

			if (this.ticks > 1e6) throw new Error("Execution exceeded 1 million ticks, possible infinite loop.");
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
				write(this.memory, this.registers.sp, this.getValue(args[0]), INT_SIZE);
				// this.memory[this.registers.sp] = this.getValue(args[0]);
				this.registers.sp += INT_SIZE;
				break;

			case "POP":
				this.registers.sp -= INT_SIZE;
				// this.setValue(args[0], this.memory[this.registers.sp]);
				this.setValue(args[0], read(this.memory, this.registers.sp, INT_SIZE));
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

			case "MOD":
				const modResult = this.getValue(args[0]) % this.getValue(args[1]);
				this.setValue(args[2], modResult);
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

			case "OUT_INT":
				const value = this.getValue(args[0]);
				if (!this.silent) console.log(`OUT: ${value}`);
				this.outputs.push(value);
				break;

			case "OUT_CHAR":
				const charCode = this.getValue(args[0]);
				if (!this.silent) console.log(`OUT: ${String.fromCharCode(charCode)}`);
				this.outputs.push(charCode);
				break;

			case "OUT_BOOL":
				const boolValue = this.getValue(args[0]);
				if (!this.silent) console.log(`OUT: ${boolValue ? "true" : "false"}`);
				this.outputs.push(boolValue);
				break;

			case "OUT_FLOAT":
				const floatValue = this.getValue(args[0]);
				if (!this.silent) console.log(`OUT: ${floatValue.toFixed(4)}`);
				this.outputs.push(floatValue);
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
		const snapshotSize = 64;
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
			// case IRArgumentType.MEM:
			// 	this.memory[parseInt(arg.value)] = value;
			// 	break;
			case IRArgumentType.MEM_REG:
				if (!(arg.value in this.registers)) throw new Error(`Invalid register: ${arg.value}`);
				const addr = this.registers[arg.value as Register] + (arg.offset || 0);
				write(this.memory, addr, value, arg.size);
				break;
			case IRArgumentType.REG:
				if (!(arg.value in this.registers)) throw new Error(`Invalid register: ${arg.value}`);
				this.registers[arg.value as Register] = value;
				break;
			default:
				throw new Error(`Unsupported argument type for setValue: ${arg.type}`);
		}
	}

	private getValue(arg: IRArgument): number {
		switch (arg.type) {
			case IRArgumentType.IMM:
				return parseFloat(arg.value);
			case IRArgumentType.REG:
				if (!(arg.value in this.registers)) throw new Error(`Invalid register: ${arg.value}`);
				return this.registers[arg.value as Register];
			// case IRArgumentType.MEM:
			// 	const val = this.memory[parseInt(arg.value)];
			// 	if (typeof val != "number") throw new Error(`Invalid memory access at address ${arg.value}: ${val}`);
			// 	return val;
			case IRArgumentType.MEM_REG:
				if (!(arg.value in this.registers)) throw new Error(`Invalid register: ${arg.value}`);
				const addr = this.registers[arg.value as Register] + (arg.offset || 0);
				const memVal = read(this.memory, addr, arg.size);
				if (typeof memVal != "number") throw new Error(`Invalid memory access at address ${addr}: ${memVal}`);
				return memVal;
			case IRArgumentType.LABEL:
				if (!this.labelIndexes.has(arg.value)) throw new Error(`Label not found: ${arg.value}`);
				return this.labelIndexes.get(arg.value)!;
			case IRArgumentType.STR:
				const strIndex = parseInt(arg.value);
				if (!this.stringLut.has(strIndex)) throw new Error(`String index not found: ${strIndex}`);
				return this.stringLut.get(strIndex)!;
			default:
				throw new Error(`Unsupported argument type: ${arg.type}`);
		}
	}
}

export { Emulator };
