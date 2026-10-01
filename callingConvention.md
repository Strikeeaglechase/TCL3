To call a function:

1. Push the current stack pointer
2. Push the current frame pointer
3. Evaluate each argument (after eval it should be left on the stack)
4. Push pc+1 (return address)
5. Jump to the function address
6. After the function concludes, it should have left its return value on the top of the stack
7. Copy return to arg1 (arg1 is at fp+2) (after doing sp=retSp, returnValue should be at sp+2)
8. Sp=retSp
9. retSp=retPc
10.   Fp=retFp
11.

```
| frame1 | |         frame2                      |
a  b  c  d retSp retFp arg1 arg2 arg3 retPc retVal
```
