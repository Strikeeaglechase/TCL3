# Turing Complete Language 3 (TLC3) Spec

## Variable declaration

`let [name]: [type] = expression;`

```c
let x: int = 5;
```

## Array declaration
`let <name>: <type>[<sizeExpression>] = {expression1, expression2, ..., expressionN};`

```c
let arr: int[5] = {1, 2, 3, 4, 5};
```

Initializer can be empty:
```c
let arr: int[5] = {};
```

Brackets are simply syntax for allocating memory for an array, the concrete type is \<type\>*, so whenever passed around use the pointer type.

## Memory management

### Pointer referencing:

Let `x = 5` at mem address `0d240`
```c
int ptr = &x; // ptr = 240
```

### Value dereferencing:
```c
int val = *ptr; // val = 5
```

## Types

`int`: integer with a length to be specified later  
`char`: 8 bit wide integer useful for whatever requires knowing it is a character  
<!-- `bool`: 1 bit wide integer useful for not confusing it with other stuff   -->
`struct`: defines a class-like structure that may hold variables and methods.

### Special non-primitive types that are part of the language
#### `string`
`string`: Array of chars

#### `struct`
**Note: structs have to be defined individually, not inline**  
`struct`: 
```c
struct Struct1 {
   int val3;
}

struct Type {
   val1: int;
   val2: int;

   fn method1(): int {
		return 5
   }

   subStruct: Struct1;
}
```

When instantiating a struct may list initializers:
```c

let s1: Struct1 = {val3: 5};

```


Accessing members of structs

From pointer of a struct `struct1`:
```c
int val = struct1->val1;
```

From a struct `struct1`:
```c
int val = struct1.val1;
```

You may also stack struct accessers, let struct `struct1`:
```c
int val = struct1->val1.val2;
int val = struct1.val1.val2;
```

You may reference to the current struct instance in a method by the keyword `this`, which is of type `struct*`:
```c
struct Type {
   num1: int;
   num2: int;

   fn method1(num1: int): void 
   {
   	this->num1 = num1;
	}
}
```

Operator overloading is allowed, using special functions with the name being a single-quoted character of the operator, for example:
```c

struct Type {
	num1: int;
	num2: int;

	fn '+'(other: Type): Type
	{
		let newType: Type = {};
		newType.num1 = this->num1 + other.num1;
		newType.num2 = this->num2 + other.num2;
		return newType;
	}
}

```

#### `enum`

`enum`:  
With specific values for each key:
```c
enum HTTPMethods {
   GET = 0,
   POST = 1,
   TRACE = 2
}
```

With ordered values for each key, starting at 0:
```c
enum HTTPMethods {
   GET,
   POST,
   TRACE
}
```

## Flow Control

### With blocks:
`if` statements
```c
if (boolean == true) 
{

}
elseif (boolean == true)
{

}
else
{

}
```

`while` loops
```c
while (boolean == true)
{

}
```

`for` loops
```c
for (statement1; statement2; statement3;)
{

}
```
`statement1`: initial state of the iterator  
`statement2`: condition for for loop to run  
`statement3`: operation on iterator at the end of the loop (including when called with `continue`)


### Without blocks:
`if` statements
```c
if (boolean == true) 
   var += 1;
elseif (boolean == true)
   var += 2;
else
   var -= 1;
```

`while` loops
```c
while (boolean == true)
   method();
```

`for` loops
```c
for (statement1; statement2; statement3;)
   method();
```

`break`: Inside of a loop, exits the loop  
`continue`: Inside of a loop, jumps to beginning of loop

## Methods

```c
fn method(arg1: int, arg2: int): int {
   return arg1 + arg2;
}
```

```c
int val = method(2, 4);
```

If our method is a single statement, we may write it as such:
```c
fn method(arg1: int, arg2: int): int arg1 + arg2;

fn method(arg1: int, arg2: int): int
   arg1 + arg2;
```

`return` is implicit, but you may still specify it (it looks pretty):
```c
fn method(int arg1, int arg2): int return arg1 + arg2;

fn method(int arg1, int arg2): int
   return arg1 + arg2;
```

## Operands

| Operand | Symbol |
| --- | --- |
| Addition | `+` |
| Subtraction | `-` |
| Multiplication | `*` |
| Division | `/` |
| Modulo | `%` |
| Negation | `-` |
| Bitwise OR | `\|` |
| Bitwise AND | `&` |
| Bitwise XOR | `^` |
| Bitwise NOT | `~` |
| Logical OR | `\|\|` |
| Logical AND | `&&` |
| Logical NOT | `!` |
| Equality | `=` |
| Inequality | `!=` |
| Less than | `<` |
| Less than or equal | `<=` |
| Greater than | `>` |
| Greater than or equal | `>=` |
| Assignement | `=` |
| Addition assignement | `+=` |
| Subtraction assignement | `-=` |
| Multiplication assignement | `*=` |
| Division assignement | `/=` |
| Postifx increment | `++` |
| Postfix decrement | `--` |

## Operator Precedence

Based on C-like languages  
**Note 1: lowest precedence means it gets interpreted first. Highest precedence means it gets interpreted last.**  
**Note 2: parentheses denote a priority over another operation, like in mathematics. In `(2 + 3) / 2`, `2 + 3` is computed first, then `5 / 2`.**  
**Note 3: precedence level 13 is left intentionally empty if we ever want to add ternary operators.**
| Precedence | Operator | Description | Associativity |
| --- | --- | --- | -- |
| 1 | `()` | Function calls | L to R |
| 1 | `[]` | Array indexing | L to R |
| 1 | `.` | Struct member indexing | L to R |
| 1 | `->` | Struct pointer member indexing | L to R |
| 1 | `++` | Postfix increment | L to R |
| 1 | `--` | Postifix decrement | L to R |
| `2` | `! ~` | Logical/bitwise NOT | `R to L` |
| `2` | `-` | Negation | `R to L` |
| `2` | `(type)` | Explicit cast | `R to L` |
| `2` | `*` | Dereference (value from ptr) | `R to L` |
| `2` | `&` | Address-of (ptr from var) | `R to L` |
| `2` | `sizeof` | Size of built-in method | `R to L` |
| 3 | `* / %` | Multiplication and division | L to R |
| `4` | `+ -` | Addition and subtraction | L to R |
| 5 | `<< >>` | Bitwise shifting | L to R |
| `6` | `< <=` | Less than [or equal] | L to R |
| 6 | `> >=` | Greater than [or equal] | L to R |
| `7` | `== !=` | Equality | L to R |
| 8 | `&` | Bitwise AND | L to R |
| `9` | `^` | Bitwise XOR | L to R |
| 10 | `\|` | Bitwise OR | L to R |
| `11` | `&&` | Logical AND | L to R |
| 12 | `\|\|` | Logical OR | L to R |
| `13` |  |  | |
| 14 | `=` | Assignement | `R to L` |
| 14 | `+= -=` | Addition and subtraction assignement | `R to L` |
| 14 | `*= /= %=` | Multiplication and division assignement | `R to L` |
