Leave does:
sp = fp
fp = pop()

Ret does:
pc = pop()

Call does:
push(pc+1)
pc = label

On function enter:
push(fp)
fp=sp
