# Suppress reverse writes during target metadata conversion

The new common publication pipeline performs target conversion before committing
its value. Conversion must retain the existing `_updatingTarget` guard: a metadata
converter may adjust a target property through SetCurrentValue, and that temporary
presentation adjustment must not be written back to the model by a TwoWay binding.
The guard now spans metadata conversion and restores its previous state in finally.
User replacement/disposal guards and the later value-commit guard remain in place.

Two focused regressions failed against the first implementation and passed after
this correction, one each for reflection and compiled bindings. Together with the
54 publication/format/lifetime tests this continuation adds 56 Node regressions.
The native/runtime/AOT/HTTP release requirements remain unchanged. This correction
does not alter the user converter's public call signature or add a new source
update policy.
