import { ORGANIZATION_TYPE_OPTIONS } from "../../entities/organization/model";
import type { OrganizationType } from "../../entities/organization/types";

export function OrganizationTypeSettings({
  selectedTypes,
  onChange,
  disabled = false,
  className = "",
}: {
  selectedTypes: OrganizationType[];
  onChange: (types: OrganizationType[]) => void;
  disabled?: boolean;
  className?: string;
}) {
  const toggleType = (type: OrganizationType) => {
    const nextTypes = selectedTypes.includes(type)
      ? selectedTypes.filter((item) => item !== type)
      : [...selectedTypes, type];
    if (nextTypes.length > 0) {
      onChange(nextTypes);
    }
  };

  return (
    <fieldset className={`builder-organization-settings ${className}`.trim()}>
      <legend>Организации для выбора:</legend>
      <div className="builder-organization-options">
        {ORGANIZATION_TYPE_OPTIONS.map((option) => (
          <label key={option.value}>
            <input
              type="checkbox"
              checked={selectedTypes.includes(option.value)}
              onChange={() => toggleType(option.value)}
              disabled={disabled || (selectedTypes.length === 1 && selectedTypes[0] === option.value)}
            />
            <span>{option.selectionLabel}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

