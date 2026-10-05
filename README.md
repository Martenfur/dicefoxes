## Dice syntax

You can roll dice using `roll` or `ролл` commands (Everything has a cyrillic alias).

### Basic example

```
roll 2d20
or
ролл 2д20
or
ролл 2к20
```

This will roll 2 20-sided dice. You can roll any number of dice with any number of faces, for example, `49d53` is also valid.

There is also support for special FATE dice. You roll them like this:

```
roll 1df
or
ролл 1дф
```

This will roll one of the following values: `-1, 0, 1`.

### Formulas

You can use mathematical operations and flat bonuses in your rolls. Supported operations are: addition, subtraction, multiplication and division. 
Formulas follow regular mathematical order of operations. Example:

```
roll (1d20 + 12) * 2 - 1d4
or
ролл (1д20 + 12) * 2 - 1д4
```

### Setting DCs

You can set a DC for your roll. Example: 

```
roll 1d20 + 5 DC15
or
ролл 1д20 + 5 ДС15
```

If you set a DC the bot will tell you if you've met it or not. There are 4 outcomes that are possible: crit fail, fail, success and crit success. 
You succeed if you meet or beat the DC. You crit succees or crit fail if you miss or exceed the DC by 10. 
If you roll a single d20, natural 20 will also promote your degree of success (for example, fail becomes a success or success becomes crit success). 
If you roll a natual 1, the opposite thing happens - you get a result that is one degree of success lower. 
