---
name: ato-language
description: "Use when writing, reading, or reviewing .ato files or ato.yaml: atopile language rules, syntax, modules/interfaces/parameters/traits, connecting, tolerances, part picking."
---

# Ato language features

## experimental features

Enable with `#pragma experiment("BRIDGE_CONNECT")`
BRIDGE_CONNECT: enables `p1 ~> resistor ~> p2` syntax
FOR_LOOP: enables `for item in container: pass` syntax
TRAITS: enables `trait trait_name` syntax
MODULE_TEMPLATING: enables `new MyComponent<param=literal>` syntax

## modules, interfaces, parameters, traits

A block is either a module, interface or component.
Components are just modules for code-as-data.
Interfaces describe a connectable interface (e.g Electrical, ElectricPower, I2C, etc).
A module is a block that can be instantiated.
Think of it as the ato equivalent of a class.
Parameters are variables for numbers and they work with constraints.
E.g `resistance: ohm` is a parameter.
Constrain with `assert resistance within 10kohm +/- 10%`.
It's very important to use toleranced values for parameters.
If you constrain a resistor.resistance to 10kohm there won't be a single part found because that's a tolerance of 0%.

Traits mark a module to have some kind of functionality that can be used in other modules.
E.g `trait has_designator_prefix` is the way to mark a module to have a specific designator prefix that will be used in the designator field in the footprint.

## connecting

You can only connect interfaces of the same type.
`resistor0.unnamed[0] ~ resistor0.unnamed[0]` is the way to connect two resistors in series.
If a module has the `can_bridge` trait you can use the sperm operator `~>` to bridge the module.
`led.anode ~> resistor ~> power.hv` connects the anode in series with the resistor and then the resistor in series with the high voltage power supply.

## for loop syntax

`for item in container: pass` is the way to iterate over a container.

# Ato CLI

## How to run

In T3CAD, build with the `ato_build` tool (see the atopile-t3cad skill) instead of running `ato` yourself.

## Packages

Packages can be found on the ato registry.
To install a package you need to run `ato add <PACKAGE_NAME>`.
e.g `ato install atopile/addressable-leds`
And then can be imported with `from "atopile/addressable-leds/sk6805-ec20.ato" import SK6805_EC20_driver`.
And used like this:

```ato
module MyModule:
    led = new SK6805_EC20_driver
```

## Footprints & Part picking

Footprint selection is done through the part choice (`ato create part` auto-generates ato code for the part).
The `pin` keyword is used to build footprint pinmaps so avoid using it outside of `component` blocks.
Preferrably use `Electrical` interface for electrical interfaces.
A lot of times it's actually `ElectricLogic` for things like GPIOs etc or `ElectricPower` for power supplies.

Passive modules (Resistors, Capacitors) are picked automatically by the constraints on their parameters.
To constrain the package do e.g `package = "0402"`.
To explictly pick a part for a module use `lcsc = "<LCSC_PART_NUMBER>"`.

# What ato does not have

- if statements
- while loops
- functions (calls or definitions)
- classes
- objects
- exceptions
- generators

# Syntax reference

Every statement form the parser accepts, in one annotated file.

```ato
#pragma text
#pragma func("X")
# enable for loop syntax feature:
#pragma experiment("FOR_LOOP)

# --- Imports ---
# Standard import (newline terminated)
import ModuleName

# Import with multiple modules (newline terminated)
import Module1, Module2.Submodule

# Import from a specific file/source (newline terminated)
from "path/to/source.ato" import SpecificModule

# Multiple imports on one line (semicolon separated)
import AnotherModule; from "another/source.ato" import AnotherSpecific

# Deprecated import form (newline terminated)
# TODO: remove when unsupported
import DeprecatedModule from "other/source.ato"

# --- Top-level Definitions and Statements ---

pass
pass;

"docstring-like statement"
"docstring-like statement";

top_level_var = 123

# Compound statement
pass; another_var = 456; "another docstring"

# Block definitions
component MyComponent:
    # Simple statement inside block (newline terminated)
    pass

    # Multiple simple statements on one line (semicolon separated)
    pass; internal_flag = True

module AnotherBaseModule:
    pin base_pin
    base_param = 10

interface MyInterface:
    pin io

module DemoModule from AnotherBaseModule:
    # --- Declarations ---
    pin p1              # Pin declaration with name
    pin 1               # Pin declaration with number
    pin "GND"           # Pin declaration with string
    signal my_signal    # Signal definition
    a_field: AnotherBaseModule      # Field declaration with type hint

    # --- Assignments ---
    # Newline terminated:
    internal_variable = 123

    # Semicolon separated on one line:
    var_a = 1; var_b = "string"

    # Cumulative assignment (+=, -=) - Newline terminated
    value = 1
    value += 1; value -= 1

    # Set assignment (|=, &=) - Newline terminated
    flags |= 1; flags &= 2

    # --- Connections ---
    p1 ~ base_pin
    mif ~> bridge
    mif ~> bridge ~> bridge
    mif ~> bridge ~> bridge ~> mif
    bridge ~> mif
    mif <~ bridge
    mif <~ bridge <~ bridge
    mif <~ bridge <~ bridge <~ mif
    bridge <~ mif

    # Semicolon separated on one line:
    p_multi1 ~ my_signal; p_multi2 ~ sig_multi1

    # --- Retyping ---
    instance.x -> AnotherBaseModule

    # --- Instantiation ---
    instance = new MyComponent
    container = new MyComponent[10]
    templated_instance_a = new MyComponent
    templated_instance_b = new MyComponent<int_=1>
    templated_instance_c = new MyComponent<float_=2.5>
    templated_instance_d = new MyComponent<string_="hello">
    templated_instance_e = new MyComponent<int_=1, float_=2.5, string_="hello">
    templated_instance_f = new MyComponent<int_=1, float_=2.5, string_="hello", bool_=True>

    # Semicolon separated instantiations (via assignment):
    inst_a = new MyComponent; inst_b = new AnotherBaseModule

    # --- Traits ---
    trait trait_name
    trait trait_name<int_=1>
    trait trait_name<float_=2.5>
    trait trait_name<string_="hello">
    trait trait_name<bool_=True>
    trait trait_name::constructor
    trait trait_name::constructor<int_=1>

    # Semicolon separated on one line:
    trait TraitA; trait TraitB::constructor; trait TraitC<arg_=1>

    # --- Assertions ---
    assert x > 5V
    assert x < 10V
    assert 5V < x < 10V
    assert x >= 5V
    assert x <= 10V
    assert current within 1A +/- 10mA
    assert voltage within 1V +/- 10%
    assert resistance is 1kohm to 1.1kohm

    # Semicolon separated on one line:
    assert x is 1V; assert another_param is 2V

    # --- Loops ---
    for item in container:
        item ~ p1

    # For loop iterating over a slice
    for item in container[0:4]:
        pass
        item.value = 1; pass

    # For loop iterating over a list literal of field references
    for ref in [p1, x.1, x.GND]:
        pass

    # --- References and Indexing ---
    # Reference with array index assignment
    array_element = container[3]

    # --- Literals and Expressions ---
    # Integer
    int_val = 100
    neg_int_val = -50
    hex_val = 0xF1
    bin_val = 0b10
    oct_val = 0o10
    # Float
    float_val = 3.14
    # Physical quantities
    voltage: V = 5V
    resistance: ohm = 10kohm
    capacitance: F = 100nF
    # Bilateral tolerance
    tolerance_val = 1kohm +/- 10%
    tolerance_abs = 5V +/- 500mV
    tolerance_explicit_unit = 10A +/- 1A
    # Bounded quantity (range)
    voltage_range = 3V to 3.6V
    # Boolean
    is_enabled = True
    is_active = False
    # String
    message = "Hello inside module"

    # Arithmetic expressions
    sum_val = 1 + 2
    diff_val = 10 - 3ohm
    prod_val = 5 * 2mA
    div_val = 10V / 2kohm # Results in current
    power_val = 2**3
    complex_expr = (5 + 3) * 2 - 1
    flag_check = state | MASK_VALUE

    # Comparisons
    assert voltage within voltage_range
    assert length <= 5mm
    assert height >= 2mm



# --- Multi-line variations ---
pass; nested_var=1; another=2

complex_assignment = (
    voltage + resistance
    * capacitance
)

```

# Common library blocks

The shapes of the standard interfaces and passives you connect to most often.

```ato
interface Electrical:
    pass

interface ElectricPower:
    hv = new Electrical
    lv = new Electrical

module Resistor:
    resistance: ohm
    max_power: W
    max_voltage: V
    unnamed = new Electrical[2]

module Capacitor:
    capacitance: F
    max_voltage: V
    unnamed = new Electrical[2]

interface I2C:
    scl = new ElectricLogic
    sda = new ElectricLogic
    frequency: Hz
    address: dimensionless

interface ElectricLogic:
    line = new Electrical
    reference = new ElectricPower
```

# Corrections for current compilers

- The attribute that pins a part is `lcsc_id = "C12345"` (also `mpn` and
  `manufacturer`). The `lcsc = "..."` spelling above is atopile's older wording
  and is not accepted.
- Install packages with `ato add <package>`; `ato install` is the old name.

# References

- Read references/grammar.g4 for the full parser grammar when a construct is not covered above.
- Read references/create_package.md when creating a new reusable atopile package.
- Read references/vibe_electronics.md for atopile's own end-to-end design workflow guidance (package research, top-level design, review).
