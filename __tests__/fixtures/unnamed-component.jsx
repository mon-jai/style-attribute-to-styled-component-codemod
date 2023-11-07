import styled from "styled-components"

// Should be modified
const Div0 = styled.div`
  common-property1: value-1;
  common-property2: value-2;
  common-property3: value-3;
  common-property4: value-4;
  common-property5: value-5;
  different-property2: value-2;
`

export default function Component() {
  return (
    <>
      <Div0 />
      <div
        style={{
          commonProperty1: "value-1",
          commonProperty2: "value-2",
          commonProperty3: "value-3",
          commonProperty4: "value-4",
          commonProperty5: "value-5",
          differentProperty1: "value-1"
        }}
      />
    </>
  )
}
