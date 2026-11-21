import { CROPS, CROP_GROUPS } from '../data/crops';

/** Opcje listy upraw pogrupowane (zboża, okopowe, …) – łatwiej znaleźć uprawę na długiej liście. */
export function CropOptions() {
  return (
    <>
      {CROP_GROUPS.map((group) => (
        <optgroup key={group.id} label={group.label}>
          {CROPS.filter((crop) => crop.group === group.id).map((crop) => (
            <option key={crop.id} value={crop.id}>
              {crop.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
