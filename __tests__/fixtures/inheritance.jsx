import styled from "styled-components"

// Should not be picked as `similarComponent`
const Div0 = styled.div`
  common-property1: value-1;
  common-property2: value-2;
  common-property3: value-3;
  common-property4: value-4;
  common-property5: value-5;
`

// Closest, should be picked as `similarComponent`
const Div1 = styled(Div0)`
  common-property6: value-6;
`

export default function Component() {
  return (
    <Div1>
      <div
        style={{
          commonProperty1: "value-1",
          commonProperty2: "value-2",
          commonProperty3: "value-3",
          commonProperty4: "value-4",
          commonProperty5: "value-5",
          commonProperty6: "value-6"
        }}
      />
    </Div1>
  )
}
