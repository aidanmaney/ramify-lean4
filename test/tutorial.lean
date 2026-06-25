import Lean


open Lean Widget

@[widget_module]
def helloWidget : Widget.Module where
  -- Inject JS stuff
  javascript := "
    import * as React from 'react';
    export default function(props) {
      const name = props.name || 'world'
      return React.createElement('p', {}, 'Hello ' + name + '!')
    }"
#widget helloWidget

structure HelloWidgetProps where
  name? : Option String := none
  deriving Server.RpcEncodable
#widget helloWidget with { name? := "<your name here>" : HelloWidgetProps}

-- Struct serializing what we're asking for
structure GetTypeParams where
  name : Name
  pos : Lsp.Position
  deriving FromJson, ToJson

open Server RequestM in
@[server_rpc_method]
def getType (params : GetTypeParams) : RequestM (RequestTask CodeWithInfos) :=
  withWaitFindSnapAtPos params.pos fun snap => do
    runTermElabM snap do
      let name <- resolveGlobalConstNoOverloadCore params.name
      let c <- try getConstInfo name
        catch _ => throwThe RequestError ⟨.invalidParams, s!"no constant named '{name}'"⟩
      Widget.ppExprTagged c.type

@[widget_module]
def checkWidget : Widget.Module where
  javascript := "
import * as React from 'react';
const e = React.createElement;
import { useRpcSession, InteractiveCode, useAsync, mapRpcError } from '@leanprover/infoview';

export default function(props) {
  const rs = useRpcSession()
  const [name, setName] = React.useState('getType')

  const st = useAsync(() =>
    rs.call('getType', { name, pos: props.pos }), [name, rs, props.pos])

  const type = st.state === 'resolved' ? st.value && e(InteractiveCode, {fmt: st.value})
    : st.state === 'rejected' ? e('p', null, mapRpcError(st.error).message)
    : e('p', null, 'Loading..')
  const onChange = (event) => { setName(event.target.value) }
  return e('div', null,
    e('input', { value: name, onChange }), ' : ', type)
}
"

#widget checkWidget


@[widget_module]
def insertTextWidget : Widget.Module where
  javascript := "
import * as React from 'react';
const e = React.createElement;
import { EditorContext } from '@leanprover/infoview';

export default function(props) {
  const editorConnection = React.useContext(EditorContext)
  function onClick() {
    editorConnection.api.insertText('-- hello!!!', 'above')
  }

  return e('div', null, e('button', { value: name, onClick }, 'insert'))
}
"

#widget insertTextWidget
