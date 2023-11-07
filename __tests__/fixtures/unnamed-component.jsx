import styled from "styled-components"

const Div0 = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  flex-direction: column;
  flex-shrink: 1;
`

export default function Component() {
  return (
    <Div0>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexWrap: "wrap",
          flexDirection: "column",
          flexGrow: 1
        }}
      />
    </Div0>
  )
}
