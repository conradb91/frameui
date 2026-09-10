import { expect, test } from 'bun:test'
import { moveNode } from './tree'
import { createPrimitiveNode } from './createPrimitiveNode'

test('moving a container into itself or a descendant preserves the tree', () => {
 const root = createPrimitiveNode('container'), parent = createPrimitiveNode('container'), child = createPrimitiveNode('container')
 parent.children.push(child); root.children.push(parent)
 expect(moveNode(root, parent.id, parent.id, 0)).toBe(root)
 expect(moveNode(root, parent.id, child.id, 0)).toBe(root)
 expect(root.children[0].children[0]).toBe(child)
})
