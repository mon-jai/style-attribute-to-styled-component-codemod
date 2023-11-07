import styled from "styled-components"

const Component1 = styled.div`
  property: 1;
`
export default function Component2() {
  return (
    <>
      <Component1 />
      <div style={{ property: 1 }} />
    </>
  )
}
