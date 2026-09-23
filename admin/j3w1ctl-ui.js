/* The editor's form building blocks: a DOM node with a class and text, and a
   labelled field (input, select or textarea) with the options every j3w1ctl
   form uses. */

export const node = (tag, className, text) => {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text !== undefined) value.textContent = text;
  return value;
};

export const field = (label, name, { type = "text", value = "", options, required = false, maxLength, className = "", controlClassName = "", rows, help } = {}) => {
  const wrapper = node("label", `ctl-field${className ? ` ${className}` : ""}`);
  wrapper.append(node("span", "", label));
  let control;
  if (type === "textarea") control = node("textarea");
  else if (type === "select") {
    control = node("select");
    options.forEach(([optionValue, text]) => {
      const option = node("option", "", text);
      option.value = optionValue;
      option.selected = optionValue === value;
      control.append(option);
    });
  } else {
    control = node("input");
    control.type = type;
  }
  control.name = name;
  if (controlClassName) control.className = controlClassName;
  control.value = value ?? "";
  control.required = required;
  if (maxLength) control.maxLength = maxLength;
  if (rows && control instanceof HTMLTextAreaElement) control.rows = rows;
  wrapper.append(control);
  if (help) wrapper.append(node("small", "ctl-field-help", help));
  return wrapper;
};
