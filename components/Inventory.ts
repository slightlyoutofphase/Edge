export interface InventoryComponent {
  currentWeapon: string; // Key in WEAPONS (e.g. 'longsword', 'rapier')
  unlockedWeapons: Set<string>;
}
