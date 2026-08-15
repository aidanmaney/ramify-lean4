import Ramify


show_panel_widgets [Ramify]

theorem cong : ∀ {α β : Type} {f : α → β} {x y : α}, x = y → f x = f y := by
  intro α β f x y h
  rw [h]

theorem goal_zero_add (n : Nat) : 0 + n = n :=
  match n with
  | Nat.zero => rfl
  | Nat.succ n => congrArg Nat.succ (goal_zero_add n)
  

-- theorem goal_mul_one (n : Nat) : n * 1 = n := by
--   sorry

-- theorem goal_add_comm (n m : Nat) : n + m = m + n := by
--   sorry

-- theorem goal_succ_ne_zero (n : Nat) : n + 1 ≠ 0 := by
--   sorry

-- theorem goal_le_add_right (n m : Nat) : n ≤ n + m := by
--   sorry

-- theorem goal_mul_add (a b c : Nat) : a * (b + c) = a * b + a * c := by
--   sorry

