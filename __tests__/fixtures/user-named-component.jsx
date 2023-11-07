import styled from "styled-components"

const Foo = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  flex-direction: column;
  flex-shrink: 1;
`

export default function Component() {
  return (
    <Foo>
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
    </Foo>
  )
}
